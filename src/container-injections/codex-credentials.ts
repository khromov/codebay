import { locateCodexCredential, validCodexAuth } from '../lib/host-codex.server.ts';
import { codexConfigFile } from '../lib/codex-settings.server.ts';
import { readContainerFile, writeContainerFile } from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

export const codexCredentials: Injection = {
	id: 'codex-credentials',
	label: 'Codex login',
	auth: {
		hint: 'run codex login, provide an OpenAI API key, or sign in inside the container',
		async status() {
			const found = await locateCodexCredential();
			return { available: !!found, source: found?.source ?? null };
		}
	},
	async apply(target, log) {
		const found = await locateCodexCredential();
		if (!found) {
			log(
				'⚠ No exportable Codex login found; run codex login --device-auth in the container or set an OpenAI API key\n'
			);
			return;
		}
		const result = await writeContainerFile(target, codexConfigFile('auth.json'), found.value);
		log(
			result.ok ? '✓ Codex login injected\n' : `⚠ Codex login injection failed: ${result.error}\n`
		);
	},
	async check(target) {
		return validCodexAuth((await readContainerFile(target, codexConfigFile('auth.json'))) ?? '');
	}
};
