import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** On Open VSX (code-server's default registry); the Marketplace build `/ide` targets is unreachable. */
export const EXTENSION_ID = 'openai.chatgpt';

const EXT_GLOB = '~/.local/share/code-server/extensions/openai.chatgpt-*';

/** Idempotent (skips if already present); best-effort — needs Open VSX egress. */
// The bracketed `install-extensio[n]` keeps pgrep from matching this script's own `bash -lc` argv,
// so it only sees the launch line's real background install (which it waits out before falling back).
export const INSTALL_SCRIPT =
	`extension=${EXTENSION_ID}; ` +
	`if ls -d ${EXT_GLOB} >/dev/null 2>&1; then exit 0; fi; ` +
	`command -v code-server >/dev/null 2>&1 || { echo "code-server not found" >&2; exit 1; }; ` +
	`for _ in {1..90}; do ` +
	`pgrep -f 'install-extensio[n] ${EXTENSION_ID}' >/dev/null 2>&1 || break; sleep 1; done; ` +
	`if ls -d ${EXT_GLOB} >/dev/null 2>&1; then exit 0; fi; ` +
	`code-server --install-extension "$extension"`;

export const CHECK_SCRIPT = `ls -d ${EXT_GLOB} >/dev/null 2>&1 && echo 1 || echo 0`;

/**
 * Runtime fallback to the build-time launch-line install in CODE_SERVER_LAUNCH; failure is
 * non-fatal since the IDE integration is optional and everything else works without it.
 */
export const codexIdeExtension: Injection = {
	id: 'codex-ide-extension',
	label: 'Codex IDE extension',
	// code-server-only; terminal-mode instances never run the extension host.
	modes: ['ide'],

	async apply(target, log) {
		log('Installing Codex IDE extension…\n');
		// Full target (with remoteUser) so it lands in that user's code-server home, where code-server reads it.
		const res = await execInContainer(target, { script: INSTALL_SCRIPT, timeoutMs: 180_000 });
		log(
			res.ok
				? '✓ Codex IDE extension installed\n'
				: `⚠ Codex IDE extension install failed: ${res.error} — IDE integration unavailable\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
