import { checkPresence } from '../lib/exec.server.ts';
import { appendLinesIfAbsent, SHELL_RC_FILES } from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

const ALIAS_LINE = "alias claude='claude --dangerously-skip-permissions'";

const CHECK_SCRIPT =
	'h=$(eval echo ~$(id -un)); ' +
	`line="${ALIAS_LINE}"; ` +
	'if grep -qF "$line" "$h/.bashrc" 2>/dev/null || grep -qF "$line" "$h/.zshrc" 2>/dev/null; ' +
	'then echo 1; else echo 0; fi';

/** Safe here only because instances are throwaway, single-tenant sandboxes. */
export const claudeSkipPermissions: Injection = {
	id: 'claude-skip-permissions',
	label: 'claude skip-permissions alias',

	async apply(target, log) {
		log('Installing claude --dangerously-skip-permissions alias…\n');
		const res = await appendLinesIfAbsent(target, SHELL_RC_FILES, [ALIAS_LINE]);
		log(
			res.ok
				? '✓ claude skip-permissions alias installed\n'
				: `⚠ claude alias setup failed: ${res.error}\n`
		);
	},

	async check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
