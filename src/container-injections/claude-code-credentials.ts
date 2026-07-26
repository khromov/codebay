import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_CODE_TOKEN, CLAUDE_KEYCHAIN_SERVICE } from '../lib/config.server.ts';
import { getOption } from '../lib/db.server.ts';
import { checkPresence, execInContainer, writeSecretFileScript } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/**
 * A token entered by the user in Settings, or null. Only honored when the
 * "set tokens manually" toggle is on; a blank field falls through to the env
 * var / host discovery so a user can set just one provider.
 */
function manualClaudeToken(): string | null {
	if (getOption('manual_tokens_enabled') !== '1') return null;
	return getOption('manual_claude_code_token')?.trim() || null;
}

/**
 * `claude` reports "Not logged in" for a credentials file carrying only an
 * `accessToken`, however valid the token — `scopes` is what flips it (checked against
 * claude 2.1.215; `expiresAt`/`subscriptionType` turn out not to matter). The real
 * grant lives server-side, so this just mirrors what an interactive login writes.
 */
const TOKEN_SCOPES = [
	'user:file_upload',
	'user:inference',
	'user:mcp_servers',
	'user:profile',
	'user:sessions:claude_code'
];

/** The credentials record to inject for a bare token supplied by the user. */
export function tokenCredentials(accessToken: string): string {
	return JSON.stringify({ claudeAiOauth: { accessToken, scopes: TOKEN_SCOPES } });
}

/**
 * Rejects credentials with no access token, and ones that are unrecoverably dead —
 * an unusable snapshot would otherwise get injected verbatim and leave the container
 * looking "logged in" (file present) while `claude` inside it isn't. A merely-stale
 * access token is still fine to inject: `claude` refreshes it in-container on first
 * run as long as the refresh token hasn't also expired, so expiry is judged by the
 * refresh token when we know its expiry, falling back to the access token's own
 * expiry only when there's no refresh-token expiry to go on.
 */
export function isValid(json: string): boolean {
	try {
		const data = JSON.parse(json) as {
			claudeAiOauth?: { accessToken?: string; expiresAt?: number; refreshTokenExpiresAt?: number };
		};
		const oauth = data.claudeAiOauth;
		if (!oauth?.accessToken) return false;
		const expiry = oauth.refreshTokenExpiresAt ?? oauth.expiresAt;
		if (typeof expiry === 'number' && expiry <= Date.now()) return false;
		return true;
	} catch {
		return false;
	}
}

/**
 * Shell test for a *live* credential file at `"$f"`. Existence isn't enough: when an
 * in-container refresh is rejected (see the shared-lineage caveat below), `claude`
 * blanks the tokens in place rather than deleting the file, leaving several hundred
 * bytes that `[ -s ]` happily reports as a healthy login. All whitespace is stripped
 * first so this holds whether the file is written compact or pretty-printed.
 */
export const LIVE_CREDENTIALS_TEST =
	'[ -s "$f" ] && tr -d \'[:space:]\' < "$f" | grep -q \'"accessToken":"[^"]\'';

/**
 * Locate the host's Claude Code OAuth credentials, returning both the JSON string
 * and a human-readable description of where it came from, or null if absent.
 * macOS keeps them in the login Keychain; Linux/others use ~/.claude/.credentials.json.
 */
async function locateClaudeCredentials(): Promise<{ creds: string; source: string } | null> {
	// A token set in Settings wins, then the env override, then host discovery.
	const manual = manualClaudeToken();
	if (manual) {
		return { creds: tokenCredentials(manual), source: 'Settings — manual token' };
	}
	if (CLAUDE_CODE_TOKEN) {
		return {
			creds: tokenCredentials(CLAUDE_CODE_TOKEN),
			source: 'CODEBAY_CLAUDE_CODE_TOKEN env var'
		};
	}

	if (process.platform === 'darwin') {
		const out = await spawnCapture([
			'security',
			'find-generic-password',
			'-s',
			CLAUDE_KEYCHAIN_SERVICE,
			'-w'
		]);
		if (out && isValid(out)) {
			return { creds: out, source: `macOS Keychain — "${CLAUDE_KEYCHAIN_SERVICE}"` };
		}
	}

	const file = join(homedir(), '.claude', '.credentials.json');
	if (existsSync(file)) {
		const raw = (await readFile(file, 'utf8')).trim();
		if (isValid(raw)) return { creds: raw, source: '~/.claude/.credentials.json' };
	}
	return null;
}

/**
 * Authorize Claude Code inside a running container as its remote user. Writes the
 * credentials (via a scrubbed shell variable, never argv) plus a `hasCompletedOnboarding` flag — the
 * latter is what stops `claude` re-running its first-run setup/login wizard.
 *
 * Both paths honor the container's CLAUDE_CONFIG_DIR: credentials at
 * $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude/.credentials.json) and
 * config at $CLAUDE_CONFIG_DIR/.claude.json (default ~/.claude.json).
 */
async function injectClaudeCredentials(
	target: ContainerTarget,
	creds: string
): Promise<{ ok: boolean; error?: string }> {
	const script =
		'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
		writeSecretFileScript('$d', '.credentials.json', '600') +
		' cfg="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"; cfg="${cfg:-$h/.claude.json}"; ' +
		'printf \'%s\' \'{"hasCompletedOnboarding":true}\' > "$cfg"; chmod 644 "$cfg"';
	const res = await execInContainer(target, { script, stdin: creds });
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Inject the host's Claude Code OAuth credentials so the in-container `claude` is
 * authorized without a fresh login. Containers are throwaway, so we copy auth into
 * each one. Skipped (with a log line) when the host has no credentials.
 *
 * Shared-lineage caveat: this snapshot is taken once at boot, and OAuth refresh tokens
 * rotate — each refresh invalidates its predecessor. Snapshotting a *live* login hands
 * one lineage to two `claude` installs, and whichever refreshes first logs the other
 * out. Only a non-rotating `claude setup-token` fixes that; re-injecting on failure
 * would just reverse who loses.
 */
export const claudeCodeCredentials: Injection = {
	id: 'claude-code-credentials',
	label: 'Claude Code',

	auth: {
		hint: 'run `claude` and sign in',
		async status() {
			const found = await locateClaudeCredentials();
			return { available: found !== null, source: found?.source ?? null };
		}
	},

	async apply(target, log) {
		const found = await locateClaudeCredentials();
		if (!found) {
			log('⚠ No Claude Code credentials found on host; skipped auth injection\n');
			return;
		}
		log('Injecting Claude Code credentials…\n');
		const injected = await injectClaudeCredentials(target, found.creds);
		log(
			injected.ok
				? '✓ Claude Code authorized in container\n'
				: `⚠ Claude auth injection failed: ${injected.error}\n`
		);
	},

	async check(target) {
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; f="$d/.credentials.json"; ' +
				`if ${LIVE_CREDENTIALS_TEST}; then echo 1; else echo 0; fi`
		);
	}
};
