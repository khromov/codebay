import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** On Open VSX (code-server's default registry); the Marketplace build `/ide` targets is unreachable. */
export const EXTENSION_ID = 'anthropic.claude-code';

const EXT_GLOB = '~/.local/share/code-server/extensions/anthropic.claude-code-*';

/** Idempotent (skips if already present); best-effort — needs Open VSX egress. */
// The bracketed `install-extensio[n]` keeps pgrep from matching this script's own `bash -lc` argv,
// so it only sees the launch line's real background install (which it waits out before falling back).
export const INSTALL_SCRIPT =
	`if ls -d ${EXT_GLOB} >/dev/null 2>&1; then exit 0; fi; ` +
	`command -v code-server >/dev/null 2>&1 || { echo "code-server not found" >&2; exit 1; }; ` +
	`for _ in {1..90}; do ` +
	`pgrep -f 'install-extensio[n] ${EXTENSION_ID}' >/dev/null 2>&1 || break; sleep 1; done; ` +
	`if ls -d ${EXT_GLOB} >/dev/null 2>&1; then exit 0; fi; ` +
	`code-server --install-extension ${EXTENSION_ID}`;

export const CHECK_SCRIPT = `ls -d ${EXT_GLOB} >/dev/null 2>&1 && echo 1 || echo 0`;

/**
 * Runtime fallback to the build-time launch-line install in CODE_SERVER_LAUNCH; failure is
 * non-fatal since the IDE integration is optional and everything else works without it.
 */
export const claudeCodeIdeExtension: Injection = {
	id: 'claude-code-ide-extension',
	label: 'Claude Code IDE extension',
	// code-server-only; terminal-mode instances never run the extension host.
	modes: ['ide'],

	async apply(target, log) {
		log('Installing Claude Code IDE extension…\n');
		// Full target (with remoteUser) so it lands in that user's code-server home, where code-server reads it.
		const res = await execInContainer(target, { script: INSTALL_SCRIPT });
		log(
			res.ok
				? '✓ Claude Code IDE extension installed\n'
				: `⚠ Claude Code IDE extension install failed: ${res.error} — /ide integration off\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
