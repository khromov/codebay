import { execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * The copied `.git` is owned by a different UID than the container user, so without this
 * git aborts every command with "dubious ownership". `*` is safe in a single-tenant sandbox.
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
