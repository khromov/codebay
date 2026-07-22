import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Multi-distro tmux install, run as root. Short-circuits when tmux is already
 * present, so a rebuild re-apply is a no-op. apt-get is the primary path (the
 * default image is Debian/Ubuntu-based); the rest are best-effort for
 * project-supplied images. Exported for the isolated tests.
 */
export const INSTALL_SCRIPT =
	'if command -v tmux >/dev/null 2>&1; then exit 0; fi; ' +
	'export DEBIAN_FRONTEND=noninteractive; ' +
	'if command -v apt-get >/dev/null 2>&1; then apt-get update -y >/dev/null && apt-get install -y --no-install-recommends tmux >/dev/null; ' +
	'elif command -v apk >/dev/null 2>&1; then apk add --no-cache tmux >/dev/null; ' +
	'elif command -v dnf >/dev/null 2>&1; then dnf install -y tmux >/dev/null; ' +
	'elif command -v microdnf >/dev/null 2>&1; then microdnf install -y tmux >/dev/null; ' +
	'elif command -v yum >/dev/null 2>&1; then yum install -y tmux >/dev/null; ' +
	'else echo "no supported package manager (tried apt-get/apk/dnf/microdnf/yum)" >&2; exit 1; fi; ' +
	'command -v tmux >/dev/null 2>&1';

/**
 * Lines appended to the container user's `~/.tmux.conf`. `mouse on` gives
 * wheel-scroll but costs code-server's native `copyOnSelection` (tmux owns
 * mouse-drag; neither a Shift/Option-drag bypass nor OSC52 passthrough reaches
 * code-server's xterm.js), so `bind m` toggles `mouse` on a keypress (prefix +
 * m) to switch between scrolling and native drag-select/copy. This shadows
 * tmux's default `prefix + m` (mark-pane) binding, unused here since the IDE
 * terminal is always a single pane. `set-clipboard`/`allow-passthrough` still
 * help keyboard-driven copy-mode against an OSC52-capable host terminal (e.g.
 * `docker exec` from iTerm2/kitty/WezTerm). `status off` hides the status bar,
 * which only cost a row for this single-session terminal. Exported for the
 * isolated tests.
 */
export const TMUX_CONF_LINES = [
	'set -g mouse on',
	'set -g history-limit 50000',
	'set -g set-clipboard on',
	'set -g allow-passthrough on',
	'set -g status off',
	'bind m set -g mouse \\; display-message "mouse: #{?mouse,on,off}"'
];

/**
 * Append each conf line to `~/.tmux.conf`, guarded with `grep -qF` so a
 * re-apply never duplicates a line; `>>` creates the file if absent. The lines
 * are passed as `$@` so no conf text is interpolated into the loop body.
 */
const CONF_SCRIPT =
	'h=$(eval echo ~$(id -un)); f="$h/.tmux.conf"; ' +
	'for line in "$@"; do ' +
	'grep -qF "$line" "$f" 2>/dev/null || printf \'%s\\n\' "$line" >> "$f"; ' +
	'done';

const CHECK_SCRIPT = 'command -v tmux >/dev/null 2>&1 && echo 1 || echo 0';

/**
 * Install tmux so the IDE's auto-launched terminal can run inside a persistent
 * named session (see `TERMINAL_TASK` in devcontainer.server.ts): closing the
 * browser only detaches the tmux client, so the Claude process and its
 * scrollback survive code-server reaping the terminal PTY.
 *
 * The primary install happens at image build time via the staged
 * `codebay-tmux` local feature (`writeTmuxFeature` in devcontainer.server.ts,
 * sharing this module's INSTALL_SCRIPT) — containers that firewall egress
 * after start can't reach package mirrors post-up. This injection is the
 * runtime fallback (INSTALL_SCRIPT short-circuits when tmux is already
 * present), writes the user's ~/.tmux.conf, and provides the health row.
 * Install failure is non-fatal — the terminal task guards on `command -v tmux`
 * and falls back to the non-persistent marker-file behavior.
 */
export const tmux: Injection = {
	id: 'tmux',
	label: 'tmux',

	async apply(target, log) {
		log('Installing tmux…\n');
		// Package installation needs root; omitting remoteUser makes execInContainer
		// run the script as root regardless of the container's remote user.
		const install = await execInContainer(
			{ containerId: target.containerId },
			{ script: INSTALL_SCRIPT }
		);
		if (!install.ok) {
			log(`⚠ tmux install failed: ${install.error} — terminal falls back to non-persistent mode\n`);
			return;
		}
		const conf = await execInContainer(target, {
			script: CONF_SCRIPT,
			args: ['tmux-conf', ...TMUX_CONF_LINES]
		});
		log(conf.ok ? '✓ tmux installed\n' : `⚠ tmux conf setup failed: ${conf.error}\n`);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
