import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Sniffs before installing, because a project-supplied image usually ships its own Claude Code —
 * and because the alternative (the upstream node feature) installs via nvm, which hard-fails on
 * any image that sets NPM_CONFIG_PREFIX. Neither branch here touches nvm: npm when the image has
 * Node, else the standalone installer, which needs no Node at all.
 *
 * `$1` is the remote user (the injection passes it; the build-time feature falls back to the
 * devcontainer CLI's `$_REMOTE_USER`) — the standalone installer puts the binary under that
 * user's `$HOME`, so running it as root would strand it in `/root`.
 */
export const INSTALL_SCRIPT =
	'if command -v claude >/dev/null 2>&1; then exit 0; fi\n' +
	'if command -v npm >/dev/null 2>&1 && npm install -g @anthropic-ai/claude-code@latest >/dev/null 2>&1; then\n' +
	'  p="$(npm prefix -g 2>/dev/null)"\n' +
	// npm's global bin is off PATH whenever the image sets its own NPM_CONFIG_PREFIX, so a bare
	// `command -v` would miss an install that just succeeded — and so would the terminal launcher.
	'  [ -n "$p" ] && [ -x "$p/bin/claude" ] && ln -sf "$p/bin/claude" /usr/local/bin/claude 2>/dev/null\n' +
	'  if command -v claude >/dev/null 2>&1 || [ -x "$p/bin/claude" ]; then exit 0; fi\n' +
	'fi\n' +
	'u="${1:-${_REMOTE_USER:-root}}"\n' +
	'h="$(getent passwd "$u" 2>/dev/null | cut -d: -f6)"; [ -n "$h" ] || h="$HOME"\n' +
	'f="$(mktemp)"\n' +
	'if command -v curl >/dev/null 2>&1; then curl -fsSL https://claude.ai/install.sh -o "$f"\n' +
	'elif command -v wget >/dev/null 2>&1; then wget -qO "$f" https://claude.ai/install.sh\n' +
	'else echo "no curl/wget to fetch the Claude Code installer" >&2; exit 1; fi\n' +
	'chmod 0755 "$f"\n' +
	// -m keeps the HOME set here, so the installer targets the remote user's home, not root's.
	'if [ "$(id -un)" = "$u" ]; then "$f" >/dev/null 2>&1\n' +
	'else HOME="$h" su -m "$u" -c "\'$f\'" >/dev/null 2>&1; fi\n' +
	'rm -f "$f"\n' +
	// The installer's ~/.local/bin is on no other user's PATH, and often not even on its own.
	'ln -sf "$h/.local/bin/claude" /usr/local/bin/claude 2>/dev/null || true\n' +
	'command -v claude >/dev/null 2>&1 || [ -x "$h/.local/bin/claude" ]\n';

const CHECK_SCRIPT = 'command -v claude >/dev/null 2>&1 && echo 1 || echo 0';

/**
 * The runtime fallback to the build-time `codebay-claude` feature, mirroring tmux/ttyd. Terminal
 * mode only: there the launcher *is* `claude`, so a missing binary leaves a bare shell — IDE-mode
 * instances on a project image keep owning their own tooling.
 */
export const claudeCodeInstall: Injection = {
	id: 'claude-code-install',
	label: 'Claude Code',
	modes: ['terminal'],

	async apply(target, log) {
		log('Checking Claude Code is installed…\n');
		// Omitting remoteUser runs as root, which the global npm install and the symlink need.
		const install = await execInContainer(
			{ containerId: target.containerId },
			{ script: INSTALL_SCRIPT, args: ['claude-install', target.remoteUser ?? ''] }
		);
		log(
			install.ok
				? '✓ Claude Code available\n'
				: `⚠ Claude Code install failed: ${install.error} — the terminal opens a plain shell\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
