import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

export const CODEX_ALIAS_LINE =
	"alias codex='codex --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust'";

const APPLY_SCRIPT =
	'h=$(eval echo ~$(id -un)); line="$1"; ' +
	'for f in "$h/.bashrc" "$h/.zshrc"; do ' +
	'grep -qF "$line" "$f" 2>/dev/null || printf \'%s\\n\' "$line" >> "$f"; ' +
	'done';

const CHECK_SCRIPT =
	'h=$(eval echo ~$(id -un)); line="$1"; ' +
	'if grep -qF "$line" "$h/.bashrc" 2>/dev/null || grep -qF "$line" "$h/.zshrc" 2>/dev/null; ' +
	'then echo 1; else echo 0; fi';

export const codexAlias: Injection = {
	id: 'codex-bypass-alias',
	label: 'codex sandbox-bypass alias',

	async apply(target, log) {
		log('Installing Codex sandbox-bypass alias…\n');
		const result = await execInContainer(target, {
			script: APPLY_SCRIPT,
			args: ['codex-alias', CODEX_ALIAS_LINE]
		});
		log(
			result.ok
				? '✓ Codex sandbox-bypass alias installed\n'
				: `⚠ Codex alias setup failed: ${result.error}\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT, ['codex-alias', CODEX_ALIAS_LINE]);
	}
};
