import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Both resolve `claude`, which `claude-skip-permissions` also aliases, so the two compose. */
const ALIAS_LINES = [
	"alias c200='CLAUDE_CODE_DISABLE_1M_CONTEXT=1 claude'",
	"alias cs='claude --model sonnet'"
];

/** Lines arrive as `$@` so no alias text is interpolated into the loop body. */
const APPLY_SCRIPT =
	'h=$(eval echo ~$(id -un)); ' +
	'for line in "$@"; do ' +
	'for f in "$h/.bashrc" "$h/.zshrc"; do ' +
	'grep -qF "$line" "$f" 2>/dev/null || printf \'%s\\n\' "$line" >> "$f"; ' +
	'done; ' +
	'done';

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
		const res = await execInContainer(target, {
			script: APPLY_SCRIPT,
			args: ['claude-aliases', ...ALIAS_LINES]
		});
		log(res.ok ? '✓ claude aliases installed\n' : `⚠ claude aliases setup failed: ${res.error}\n`);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT, ['claude-aliases', ...ALIAS_LINES]);
	}
};
