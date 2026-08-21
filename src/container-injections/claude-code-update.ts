import { execInContainer } from '../lib/exec.server.ts';
import { getOption, setOption } from '../lib/db.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * The claude-code devcontainer feature installs `npm install -g @anthropic-ai/claude-code`
 * (always latest) at *build* time, so a cached feature layer keeps serving whatever version
 * was current when the layer was first baked. This re-checks at boot and only reinstalls when
 * behind — no-op if Claude Code isn't installed (project-owned images own their tooling) or
 * npm/registry is unreachable, and it echoes `updated <old> -> <new>` so `apply()` can log it.
 *
 * `$1` is the container's remote user. Claude Code 2.x ships a native binary that npm's
 * postinstall drops into the *invoking* user's HOME, so the reinstall (and the `claude --version`
 * probes) run as that user via `run_as` — a root reinstall would strand the binary in `/root`,
 * exactly as the standalone installer in `claude-code-install.ts` would. Success is judged by a
 * post-install `claude --version` (as the remote user), not npm's exit code, so a stranded or
 * half-downloaded binary surfaces as a failure instead of a false `updated`.
 */
const RUN_AS_PRELUDE =
	'u="${1:-root}"; ' +
	// Fall back to a home the remote user actually owns, never root's — otherwise `su -m` below
	// would strand the native binary in /root, the exact failure this exists to prevent.
	'h="$(getent passwd "$u" 2>/dev/null | cut -d: -f6)"; [ -n "$h" ] || { [ "$u" = root ] && h=/root || h="/home/$u"; }; ' +
	'run_as() { if [ "$(id -un)" = "$u" ]; then HOME="$h" sh -c "$1"; else HOME="$h" su -m "$u" -c "$1"; fi; }; ' +
	"ver() { run_as 'claude --version 2>/dev/null' | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1; }; ";

const NPM_INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code@latest >/dev/null 2>&1';

/**
 * Prefer the remote user — correct HOME and ownership on the common image whose global prefix is
 * chowned to that user. Fall back to a root install with HOME pointed at the user's home when the
 * user can't write a root-owned global prefix (`su` would EACCES there). Success is decided by the
 * post-install `ver()`, so neither branch's exit status matters.
 */
const REINSTALL =
	`if run_as '${NPM_INSTALL_CMD}'; then :; ` +
	`elif [ "$(id -un)" != "$u" ]; then HOME="$h" ${NPM_INSTALL_CMD} || true; fi; `;

export const UPDATE_SCRIPT =
	'command -v claude >/dev/null 2>&1 || exit 0; ' +
	'command -v npm >/dev/null 2>&1 || exit 0; ' +
	RUN_AS_PRELUDE +
	'installed="$(ver)"; ' +
	'latest=$(npm view @anthropic-ai/claude-code version 2>/dev/null); ' +
	'if [ -z "$latest" ]; then exit 0; fi; ' +
	'if [ "$installed" = "$latest" ]; then echo "current $latest"; exit 0; fi; ' +
	REINSTALL +
	'now="$(ver)"; ' +
	'if [ "$now" = "$latest" ]; then echo "updated ${installed:-none} -> $now"; exit 0; fi; ' +
	'exit 1';

/**
 * Same check with the latest version supplied by the host as `$0` (exec args, never interpolated
 * into the script), skipping the in-container `npm view` registry round-trip. `$1` is the remote
 * user — see `UPDATE_SCRIPT` above for why the reinstall must run as that user.
 */
export const PINNED_UPDATE_SCRIPT =
	'latest="$0"; ' +
	'command -v claude >/dev/null 2>&1 || exit 0; ' +
	'command -v npm >/dev/null 2>&1 || exit 0; ' +
	RUN_AS_PRELUDE +
	'installed="$(ver)"; ' +
	'if [ "$installed" = "$latest" ]; then echo "current $latest"; exit 0; fi; ' +
	REINSTALL +
	'now="$(ver)"; ' +
	'if [ "$now" = "$latest" ]; then echo "updated ${installed:-none} -> $now"; exit 0; fi; ' +
	'exit 1';

/** Anything looser could smuggle shell metacharacters out of a corrupted DB row into a container. */
export const VERSION_RE = /^\d+\.\d+\.\d+$/;

export const CACHE_TTL_MS = 60 * 60 * 1000;

export const LATEST_VERSION_KEY = 'claude_code_latest_version';
export const LATEST_CHECKED_AT_KEY = 'claude_code_latest_checked_at';

export function cacheIsFresh(checkedAt: string | null, now: number, ttlMs = CACHE_TTL_MS): boolean {
	const t = Number(checkedAt);
	return Number.isFinite(t) && t > 0 && now - t < ttlMs;
}

/** Best-effort: any failure (offline, timeout, odd payload) returns null and the caller falls back. */
export async function fetchLatestVersion(): Promise<string | null> {
	try {
		const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', {
			signal: AbortSignal.timeout(3000)
		});
		if (!res.ok) return null;
		const version = ((await res.json()) as { version?: unknown }).version;
		return typeof version === 'string' && VERSION_RE.test(version) ? version : null;
	} catch {
		return null;
	}
}

/** Fresh cached version, a newly fetched one (cached for next time), or null → use UPDATE_SCRIPT. */
async function resolveLatestVersion(): Promise<string | null> {
	const cached = getOption(LATEST_VERSION_KEY);
	if (
		cached &&
		VERSION_RE.test(cached) &&
		cacheIsFresh(getOption(LATEST_CHECKED_AT_KEY), Date.now())
	) {
		return cached;
	}
	const version = await fetchLatestVersion();
	if (!version) return null;
	setOption(LATEST_VERSION_KEY, version);
	setOption(LATEST_CHECKED_AT_KEY, String(Date.now()));
	return version;
}

/** Best-effort, non-fatal — a failed update leaves the cached version in place. */
export const claudeCodeUpdate: Injection = {
	id: 'claude-code-update',
	label: 'Claude Code up to date',

	async apply(target, log) {
		log('Checking Claude Code is up to date…\n');
		const latest = await resolveLatestVersion();
		// Runs as root (remoteUser omitted) so the script can `su -m` into the remote user for the
		// reinstall, keeping Claude Code 2.x's native binary in that user's HOME (see UPDATE_SCRIPT).
		const res = await execInContainer(
			{ containerId: target.containerId },
			latest
				? { script: PINNED_UPDATE_SCRIPT, args: [latest, target.remoteUser ?? ''], capture: true }
				: { script: UPDATE_SCRIPT, args: ['claude-update', target.remoteUser ?? ''], capture: true }
		);
		if (!res.ok) {
			log(`⚠ Claude Code update check failed: ${res.error} — keeping the installed version\n`);
			return;
		}
		const status = res.stdout.split('\n').at(-1)?.trim() ?? '';
		if (status.startsWith('updated ')) log(`✓ Claude Code ${status.slice('updated '.length)}\n`);
		else if (status.startsWith('current '))
			log(`✓ Claude Code already latest (${status.slice('current '.length)})\n`);
		else log('✓ Claude Code version check done\n');
	}
};
