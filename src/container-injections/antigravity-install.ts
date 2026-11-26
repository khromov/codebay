import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Installs Antigravity CLI (`agy`) via its official Unix bootstrapper when absent.
 * `$1` is the remote user (passed by the injection; the build-time feature falls back to
 * `$_REMOTE_USER`), so the native binary lands in that user's `~/.local/bin` rather than `/root`,
 * then gets symlinked into `/usr/local/bin/agy` so every user and non-login shell finds it.
 */
export const INSTALL_SCRIPT =
	'if command -v agy >/dev/null 2>&1; then exit 0; fi\n' +
	'u="${1:-${_REMOTE_USER:-root}}"\n' +
	'h="$(getent passwd "$u" 2>/dev/null | cut -d: -f6)"; [ -n "$h" ] || { [ "$u" = root ] && h=/root || h="/home/$u"; }\n' +
	'if [ -x "$h/.local/bin/agy" ]; then ln -sf "$h/.local/bin/agy" /usr/local/bin/agy 2>/dev/null || true; exit 0; fi\n' +
	'f="$(mktemp)"\n' +
	'if command -v curl >/dev/null 2>&1; then curl -fsSL https://antigravity.google/cli/install.sh -o "$f"\n' +
	'elif command -v wget >/dev/null 2>&1; then wget -qO "$f" https://antigravity.google/cli/install.sh\n' +
	'else echo "no curl/wget to fetch the Antigravity CLI installer" >&2; exit 1; fi\n' +
	'chmod 0755 "$f"\n' +
	'if [ "$(id -un)" = "$u" ]; then HOME="$h" bash "$f" >/dev/null 2>&1\n' +
	'else HOME="$h" su -m "$u" -c "bash \'$f\'" >/dev/null 2>&1; fi\n' +
	'rm -f "$f"\n' +
	'ln -sf "$h/.local/bin/agy" /usr/local/bin/agy 2>/dev/null || true\n' +
	'command -v agy >/dev/null 2>&1 || [ -x "$h/.local/bin/agy" ]\n';

const CHECK_SCRIPT = 'command -v agy >/dev/null 2>&1 && echo 1 || echo 0';

/** Runtime fallback to the build-time `codebay-antigravity` feature, mirroring tmux/ttyd/claude. */
export const antigravityInstall: Injection = {
	id: 'antigravity-install',
	label: 'Antigravity installed',

	async apply(target, log) {
		log('Checking Antigravity CLI is installed…\n');
		// Omitting remoteUser runs as root, which creating the /usr/local/bin symlink needs.
		const install = await execInContainer(
			{ containerId: target.containerId },
			{ script: INSTALL_SCRIPT, args: ['antigravity-install', target.remoteUser ?? ''] }
		);
		log(
			install.ok
				? '✓ Antigravity CLI available\n'
				: `⚠ Antigravity CLI install failed: ${install.error}\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
