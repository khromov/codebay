import {
	appendLinesIfAbsent,
	linesPresent,
	SHELL_RC_FILES
} from '../lib/container-files.server.ts';
import { getOption } from '../lib/db.server.ts';
import { claudePermissionFlags, normalizePermissionMode } from '../types.ts';
import type { ClaudePermissionMode } from '../types.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Also read by `provision()`, which bakes the same flags into the container's launcher. */
export function getClaudePermissionMode(): ClaudePermissionMode {
	return normalizePermissionMode(getOption('claude_permission_mode'));
}

const aliasLine = () => `alias claude='claude ${claudePermissionFlags(getClaudePermissionMode())}'`;

/**
 * Keeps a hand-typed `claude` on the same permission mode the auto-launched session gets.
 * The `default` mode's bypass is safe here only because instances are throwaway sandboxes.
 */
export const claudePermissionMode: Injection = {
	id: 'claude-permission-mode',
	label: 'claude permission mode',

	async apply(target, log) {
		const line = aliasLine();
		log(`Installing ${line}…\n`);
		const res = await appendLinesIfAbsent(target, SHELL_RC_FILES, [line]);
		log(
			res.ok
				? '✓ claude permission-mode alias installed\n'
				: `⚠ claude alias setup failed: ${res.error}\n`
		);
	},

	async check(target) {
		return linesPresent(target, SHELL_RC_FILES, [aliasLine()]);
	}
};
