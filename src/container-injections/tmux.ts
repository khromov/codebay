import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { appendLinesIfAbsent } from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** apt-get is the real path (the default image is Debian); the rest cover project images. */
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
 * `mouse on` buys wheel-scroll at the cost of code-server's native drag-select, since tmux
 * takes the mouse — hence `bind m` to toggle it, shadowing mark-pane, unused in a single pane.
 */
export const TMUX_CONF_LINES = [
	'set -g mouse on',
	'set -g history-limit 50000',
	'set -g set-clipboard on',
	'set -g allow-passthrough on',
	'set -g status off',
	'bind m set -g mouse \\; display-message "mouse: #{?mouse,on,off}"'
];

const CHECK_SCRIPT = 'command -v tmux >/dev/null 2>&1 && echo 1 || echo 0';

/**
 * The runtime fallback to the build-time `codebay-tmux` feature, which is the primary
 * install; failure is non-fatal because the terminal task guards on `command -v tmux`.
 */
export const tmux: Injection = {
	id: 'tmux',
	label: 'tmux',

	async apply(target, log) {
		log('Installing tmux…\n');
		// Omitting remoteUser runs as root, which the package install needs.
		const install = await execInContainer(
			{ containerId: target.containerId },
			{ script: INSTALL_SCRIPT }
		);
		if (!install.ok) {
			log(`⚠ tmux install failed: ${install.error} — terminal falls back to non-persistent mode\n`);
			return;
		}
		const conf = await appendLinesIfAbsent(target, [{ name: '.tmux.conf' }], TMUX_CONF_LINES);
		log(conf.ok ? '✓ tmux installed\n' : `⚠ tmux conf setup failed: ${conf.error}\n`);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
