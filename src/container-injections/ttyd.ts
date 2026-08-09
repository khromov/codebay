import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Package managers first (ttyd is in recent Debian/Ubuntu/Alpine repos), then the upstream
 * static binary for arches/distros without a package. The default image is Debian, so apt-get
 * is the real path.
 */
export const INSTALL_SCRIPT =
	'if command -v ttyd >/dev/null 2>&1; then exit 0; fi; ' +
	'export DEBIAN_FRONTEND=noninteractive; ' +
	'if command -v apt-get >/dev/null 2>&1; then apt-get update -y >/dev/null 2>&1 && apt-get install -y --no-install-recommends ttyd >/dev/null 2>&1 && command -v ttyd >/dev/null 2>&1 && exit 0; fi; ' +
	'if command -v apk >/dev/null 2>&1; then apk add --no-cache ttyd >/dev/null 2>&1 && command -v ttyd >/dev/null 2>&1 && exit 0; fi; ' +
	'case "$(uname -m)" in x86_64|amd64) t=x86_64;; aarch64|arm64) t=aarch64;; armv7l|armv6l) t=arm;; i686|i386) t=i686;; *) echo "unsupported arch: $(uname -m)" >&2; exit 1;; esac; ' +
	'url="https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.$t"; ' +
	'if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" -o /usr/local/bin/ttyd; ' +
	'elif command -v wget >/dev/null 2>&1; then wget -qO /usr/local/bin/ttyd "$url"; ' +
	'else echo "no curl/wget to fetch ttyd" >&2; exit 1; fi; ' +
	'chmod +x /usr/local/bin/ttyd; command -v ttyd >/dev/null 2>&1';

const CHECK_SCRIPT = 'command -v ttyd >/dev/null 2>&1 && echo 1 || echo 0';

/**
 * The runtime fallback to the build-time `codebay-ttyd` feature (the primary install), mirroring
 * tmux. Terminal-mode only — `resolveInjections(mode)` keeps it out of IDE instances entirely.
 */
export const ttyd: Injection = {
	id: 'ttyd',
	label: 'ttyd',
	modes: ['terminal'],

	async apply(target, log) {
		log('Installing ttyd…\n');
		// Omitting remoteUser runs as root, which the package install / /usr/local/bin write needs.
		const install = await execInContainer(
			{ containerId: target.containerId },
			{ script: INSTALL_SCRIPT }
		);
		log(
			install.ok
				? '✓ ttyd installed\n'
				: `⚠ ttyd install failed: ${install.error} — the terminal won't be reachable\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
