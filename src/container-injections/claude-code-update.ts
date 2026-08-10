import { execInContainer } from '../lib/exec.server.ts';
import { getOption, setOption } from '../lib/db.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * The claude-code devcontainer feature installs `npm install -g @anthropic-ai/claude-code`
 * (always latest) at *build* time, so a cached feature layer keeps serving whatever version
 * was current when the layer was first baked. This re-checks at boot and only reinstalls when
 * behind — no-op if Claude Code isn't installed (project-owned images own their tooling) or
 * npm/registry is unreachable, and it echoes `updated <old> -> <new>` so `apply()` can log it.
 */
export const UPDATE_SCRIPT =
	'command -v claude >/dev/null 2>&1 || exit 0; ' +
	'command -v npm >/dev/null 2>&1 || exit 0; ' +
	"installed=$(claude --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1); " +
	'latest=$(npm view @anthropic-ai/claude-code version 2>/dev/null); ' +
	'if [ -z "$latest" ]; then exit 0; fi; ' +
	'if [ "$installed" = "$latest" ]; then echo "current $latest"; exit 0; fi; ' +
	'npm install -g @anthropic-ai/claude-code@latest >/dev/null 2>&1 || exit 1; ' +
	'echo "updated $installed -> $latest"';

/**
 * Same check with the latest version supplied by the host as `$0` (exec args, never interpolated
 * into the script), skipping the in-container `npm view` registry round-trip.
 */
export const PINNED_UPDATE_SCRIPT =
	'latest="$0"; ' +
	'command -v claude >/dev/null 2>&1 || exit 0; ' +
	'command -v npm >/dev/null 2>&1 || exit 0; ' +
	"installed=$(claude --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1); " +
	'if [ "$installed" = "$latest" ]; then echo "current $latest"; exit 0; fi; ' +
	'npm install -g @anthropic-ai/claude-code@latest >/dev/null 2>&1 || exit 1; ' +
	'echo "updated $installed -> $latest"';

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
		// Omitting remoteUser runs as root, which the global npm reinstall needs.
		const res = await execInContainer(
			{ containerId: target.containerId },
			latest
				? { script: PINNED_UPDATE_SCRIPT, args: [latest], capture: true }
				: { script: UPDATE_SCRIPT, capture: true }
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
