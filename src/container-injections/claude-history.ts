import type { Injection } from '../lib/injections.server.ts';
import { CLAUDE_RESTORE_MOUNT } from '../lib/devcontainer.server.ts';
import { afterMarker, execInContainer } from '../lib/exec.server.ts';

const RESTORE_MARKER = '__CODEBAY_RESTORE__';

/**
 * `cp -n` isn't in busybox, so missing files are selected explicitly; the count rides a marker
 * because the login shell's profile output precedes anything the script prints.
 */
export function restoreScript(mountDir: string = CLAUDE_RESTORE_MOUNT): string {
	return (
		`h=$(eval echo ~$(id -un)); cfg="\${CLAUDE_CONFIG_DIR:-$h/.claude}"; ` +
		`cd ${mountDir} 2>/dev/null || { printf '%s0\\n' '${RESTORE_MARKER}'; exit 0; }; ` +
		// Listed to a file, not piped: a pipeline would run the loop in a subshell the count dies with.
		// Redirecting the loop (rather than word-splitting `find`) also survives a path with spaces.
		`l="\${TMPDIR:-/tmp}/codebay-restore.$$"; find . -type f > "$l"; n=0; ` +
		`while IFS= read -r f; do ` +
		`d="$cfg/\${f#./}"; ` +
		// A file the container already has is live state; the mirror is only ever a floor.
		`[ -e "$d" ] && continue; ` +
		`mkdir -p "$(dirname "$d")" && cp "$f" "$d" && n=$((n + 1)); ` +
		`done < "$l"; rm -f "$l"; printf '%s%s\\n' '${RESTORE_MARKER}' "$n"`
	);
}

/**
 * A rebuild recreates the container filesystem, so `~/.claude` — and with it every transcript
 * `/resume` offers — starts empty. The host mirror is bind-mounted back in read-only; this copies
 * whatever the fresh container is missing out of it.
 */
export const claudeHistory: Injection = {
	id: 'claude-history',
	label: 'Claude history',

	async apply(target, log) {
		const res = await execInContainer(target, { script: restoreScript(), capture: true });
		if (!res.ok) {
			log(`⚠ Claude history restore failed: ${res.error}\n`);
			return;
		}
		const count = Number(afterMarker(res.stdout, RESTORE_MARKER)?.trim());
		if (count > 0) log(`✓ Restored ${count} Claude conversation file(s) from a previous build\n`);
	}
};
