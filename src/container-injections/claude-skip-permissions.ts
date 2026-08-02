import {
	appendLinesIfAbsent,
	linesPresent,
	SHELL_RC_FILES
} from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

const ALIAS_LINE = "alias claude='claude --dangerously-skip-permissions'";

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
		return linesPresent(target, SHELL_RC_FILES, [ALIAS_LINE]);
	}
};
