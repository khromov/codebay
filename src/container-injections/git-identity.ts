import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** The host user's global git identity, ready to apply inside a container. */
interface GitIdentity {
	name: string;
	email: string;
}

/** Read one `git config --global --get <key>` value from the host, or null. */
function readGitConfig(key: string): Promise<string | null> {
	return spawnCapture(['git', 'config', '--global', '--get', key]);
}

/**
 * Read the host's global git identity (`user.name` + `user.email`). Uses
 * `git config --global` so it reflects the host user's `~/.gitconfig` rather than
 * any repo-local override from the manager's own checkout. Returns null when
 * either field is missing.
 */
async function readGitIdentity(): Promise<GitIdentity | null> {
	const [name, email] = await Promise.all([
		readGitConfig('user.name'),
		readGitConfig('user.email')
	]);
	return name && email ? { name, email } : null;
}

/**
 * Inject the host's git author identity so commits made inside the container are
 * attributed to the same person as on the host. The copied workspace keeps its
 * `.git` but carries no author identity, so `git commit` would otherwise fail
 * ("Please tell me who you are") or commit as `root@<container>`. Skipped (with a
 * log line) when the host has no global identity configured.
 */
export const gitIdentity: Injection = {
	id: 'git-identity',
	label: 'git identity',

	auth: {
		hint: 'run `git config --global user.name/.email`',
		async status() {
			const identity = await readGitIdentity();
			return identity
				? { available: true, source: `git config — ${identity.name}` }
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
		// name/email are non-secret, so pass them as args ($1/$2) rather than
		// interpolating into the script — sidesteps quoting for names with spaces.
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
