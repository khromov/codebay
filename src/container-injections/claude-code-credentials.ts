import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { hostClaudeFile } from '../lib/host-claude.server.ts';
import { CLAUDE_CODE_TOKEN, CLAUDE_KEYCHAIN_SERVICE } from '../lib/config.server.ts';
import { getOption } from '../lib/db.server.ts';
import { checkPresence } from '../lib/exec.server.ts';
import { deepMerge, editJsonFile, writeContainerFile } from '../lib/container-files.server.ts';
import { CLAUDE_JSON_FILE, claudeConfigFile } from '../lib/claude-settings.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** A blank field falls through to the env var, so a user can set just one provider. */
function manualClaudeToken(): string | null {
	if (getOption('manual_tokens_enabled') !== '1') return null;
	return getOption('manual_claude_code_token')?.trim() || null;
}

/**
 * `claude` reports "Not logged in" without these, however valid the access token —
 * `scopes` is what flips it (checked against claude 2.1.215; `expiresAt` doesn't matter).
 */
const TOKEN_SCOPES = [
	'user:file_upload',
	'user:inference',
	'user:mcp_servers',
	'user:profile',
	'user:sessions:claude_code'
];

export function tokenCredentials(accessToken: string): string {
	return JSON.stringify({ claudeAiOauth: { accessToken, scopes: TOKEN_SCOPES } });
}

/**
 * A stale access token is still worth injecting — `claude` refreshes it in-container —
 * so expiry is judged by the refresh token whenever its expiry is known.
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
 * `[ -s ]` isn't enough: on a rejected refresh `claude` blanks the tokens in place
 * rather than deleting the file. Whitespace is stripped so compact and pretty JSON both match.
 */
export const LIVE_CREDENTIALS_TEST =
	'[ -s "$f" ] && tr -d \'[:space:]\' < "$f" | grep -q \'"accessToken":"[^"]\'';

/** macOS keeps these in the login Keychain; everything else uses ~/.claude/.credentials.json. */
async function locateClaudeCredentials(): Promise<{ creds: string; source: string } | null> {
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

	const file = hostClaudeFile('.credentials.json');
	if (existsSync(file)) {
		const raw = (await readFile(file, 'utf8')).trim();
		if (isValid(raw)) return { creds: raw, source: '~/.claude/.credentials.json' };
	}
	return null;
}

/** `hasCompletedOnboarding` is what stops `claude` re-running its first-run setup wizard. */
async function injectClaudeCredentials(
	target: ContainerTarget,
	creds: string
): Promise<{ ok: boolean; error?: string }> {
	const wrote = await writeContainerFile(
		target,
		claudeConfigFile('.credentials.json', '600'),
		creds
	);
	if (!wrote.ok) return wrote;
	return editJsonFile(target, CLAUDE_JSON_FILE, (cur) =>
		deepMerge(cur, { hasCompletedOnboarding: true })
	);
}

/**
 * Caveat: refresh tokens rotate, so snapshotting a live login hands one lineage to two
 * `claude` installs and whichever refreshes first logs the other out. Only `setup-token` fixes it.
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
