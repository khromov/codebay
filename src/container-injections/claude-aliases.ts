import {
	appendLinesIfAbsent,
	linesPresent,
	SHELL_RC_FILES
} from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Both resolve `claude`, which `claude-permission-mode` also aliases, so the two compose. */
const ALIAS_LINES = [
	"alias c200='CLAUDE_CODE_DISABLE_1M_CONTEXT=1 claude'",
	"alias cs='claude --model sonnet'"
];

export const claudeAliases: Injection = {
	id: 'claude-aliases',
	label: 'claude aliases',

	async apply(target, log) {
		log('Installing c200 / cs claude aliases…\n');
		const res = await appendLinesIfAbsent(target, SHELL_RC_FILES, ALIAS_LINES);
		log(res.ok ? '✓ claude aliases installed\n' : `⚠ claude aliases setup failed: ${res.error}\n`);
	},

	async check(target) {
		return linesPresent(target, SHELL_RC_FILES, ALIAS_LINES);
	}
};
