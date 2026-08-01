import { checkPresence } from '../lib/exec.server.ts';
import { appendLinesIfAbsent, SHELL_RC_FILES } from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Both resolve `claude`, which `claude-skip-permissions` also aliases, so the two compose. */
const ALIAS_LINES = [
	"alias c200='CLAUDE_CODE_DISABLE_1M_CONTEXT=1 claude'",
	"alias cs='claude --model sonnet'"
];

const CHECK_SCRIPT =
	'h=$(eval echo ~$(id -un)); ' +
	'for line in "$@"; do ' +
	'grep -qF "$line" "$h/.bashrc" 2>/dev/null || grep -qF "$line" "$h/.zshrc" 2>/dev/null || ' +
	'{ echo 0; exit 0; }; ' +
	'done; ' +
	'echo 1';

export const claudeAliases: Injection = {
	id: 'claude-aliases',
	label: 'claude aliases',

	async apply(target, log) {
		log('Installing c200 / cs claude aliases…\n');
		const res = await appendLinesIfAbsent(target, SHELL_RC_FILES, ALIAS_LINES);
		log(res.ok ? '✓ claude aliases installed\n' : `⚠ claude aliases setup failed: ${res.error}\n`);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT, ['claude-aliases', ...ALIAS_LINES]);
	}
};
