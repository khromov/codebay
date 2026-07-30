import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import { getOption } from '../lib/db.server.ts';
import type { Injection } from '../lib/injections.server.ts';

interface GitIdentity {
	name: string;
	email: string;
}

function readGitConfig(key: string): Promise<string | null> {
	return spawnCapture(['git', 'config', '--global', '--get', key]);
}

/** Both fields are required together — a lone name or email is treated as not configured. */
function overrideIdentity(): GitIdentity | null {
	const name = getOption('git_identity_name')?.trim() || '';
	const email = getOption('git_identity_email')?.trim() || '';
	return name && email ? { name, email } : null;
}

/** `--global` so the host fallback reads the host user's identity, not the manager checkout's. */
export async function readGitIdentity(): Promise<GitIdentity | null> {
	const override = overrideIdentity();
	if (override) return override;
	const [name, email] = await Promise.all([
		readGitConfig('user.name'),
		readGitConfig('user.email')
	]);
	return name && email ? { name, email } : null;
}

/** Without this, `git commit` in the container fails outright or commits as `root@<container>`. */
export const gitIdentity: Injection = {
	id: 'git-identity',
	label: 'git identity',

	auth: {
		hint: 'run `git config --global user.name/.email`',
		async status() {
			const identity = await readGitIdentity();
			return identity
				? {
						available: true,
						source: overrideIdentity()
							? `Settings override — ${identity.name}`
							: `git config — ${identity.name}`
					}
				: { available: false, source: null };
		}
	},

	async apply(target, log) {
		const identity = await readGitIdentity();
		if (!identity) {
			log('⚠ No global git identity found on host; skipped git identity injection\n');
			return;
		}
		log('Injecting git identity…\n');
		// Passed as args so a name with spaces or quotes needs no escaping.
		const res = await execInContainer(target, {
			script: 'git config --global user.name "$1"; git config --global user.email "$2"',
			args: ['git-identity', identity.name, identity.email]
		});
		log(
			res.ok
				? `✓ git identity set to ${identity.name} <${identity.email}>\n`
				: `⚠ git identity injection failed: ${res.error}\n`
		);
	},

	async check(target) {
		return checkPresence(
			target,
			'[ -n "$(git config --global user.name)" ] && [ -n "$(git config --global user.email)" ] && echo 1 || echo 0'
		);
	}
};
