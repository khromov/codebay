import { execInContainer } from '../lib/exec.server.ts';
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

/** Best-effort, non-fatal — a failed update leaves the cached version in place. */
export const claudeCodeUpdate: Injection = {
	id: 'claude-code-update',
	label: 'Claude Code up to date',

	async apply(target, log) {
		log('Checking Claude Code is up to date…\n');
		// Omitting remoteUser runs as root, which the global npm reinstall needs.
		const res = await execInContainer(
			{ containerId: target.containerId },
			{ script: UPDATE_SCRIPT, capture: true }
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
