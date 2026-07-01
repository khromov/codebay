import { execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Mark the workspace as a safe git directory for the container user. The
 * workspace is copied from the host, so its `.git` is owned by a different UID
 * than the container user — without this, git aborts every command with
 * "dubious ownership". Uses `*` since instances are throwaway and single-tenant.
 */
export const gitSafeDirectory: Injection = {
	id: 'git-safe-directory',
	label: 'git safe.directory',

	async apply(target, log) {
		const res = await execInContainer(target, {
			script: "git config --global --add safe.directory '*'"
		});
		if (!res.ok) log(`⚠ git safe.directory setup failed: ${res.error}\n`);
	}
};
