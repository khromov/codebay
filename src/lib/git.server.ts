import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGhToken } from '../container-injections/github-credentials.ts';
import { parseRepoUrl } from './repo-url.ts';

/**
 * Read the branch currently checked out in an instance's workspace by parsing
 * `.git/HEAD`. The workspace copy is bind-mounted into the container, so the host
 * file tracks the live branch inside the running container — reading it here is a
 * cheap poll that needs no `docker exec`. Returns the branch name, a short SHA when
 * HEAD is detached, or null when there is no readable git repo.
 */
export async function readGitBranch(workspacePath: string): Promise<string | null> {
	try {
		const head = (await readFile(join(workspacePath, '.git', 'HEAD'), 'utf8')).trim();
		const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
		if (ref) return ref[1] ?? null;
		// Detached HEAD: the file holds a raw commit SHA instead of a ref.
		return head ? head.slice(0, 7) : null;
	} catch {
		return null;
	}
}

/**
 * Clone a Git repository into `dest`, streaming git's progress (written to stderr)
 * to `onLog`. GitHub clones are authenticated with the host's `gh` token, injected
 * as an HTTP auth header via git's env-scoped config (`GIT_CONFIG_*`) so the secret
 * never lands in argv nor in the cloned repo's persisted `.git/config` — the stored
 * remote stays the clean https URL, which the in-container gh credential injection
 * then reuses for push/pull. `GIT_TERMINAL_PROMPT=0` makes a missing/invalid token
 * fail fast instead of blocking on an interactive prompt. Throws on a non-zero exit.
 */
export async function cloneRepo(
	source: string,
	dest: string,
	onLog: (chunk: string) => void,
	opts: { branch?: string } = {}
): Promise<void> {
	const parsed = parseRepoUrl(source);
	if (!parsed) throw new Error(`Invalid repository URL: ${source}`);

	const env: Record<string, string | undefined> = {
		...process.env,
		GIT_TERMINAL_PROMPT: '0'
	};

	if (parsed.host === 'github.com') {
		const found = await readGhToken();
		if (found) {
			const basic = Buffer.from(`x-access-token:${found.token}`).toString('base64');
			env.GIT_CONFIG_COUNT = '1';
			env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
			env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
		}
	}

	const args = ['git', 'clone', '--progress'];
	if (opts.branch?.trim()) args.push('--branch', opts.branch.trim());
	args.push(parsed.cloneUrl, dest);

	const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', env });

	let stderrTail = '';
	const decoder = new TextDecoder();
	const pump = async (stream: ReadableStream<Uint8Array>, capture: boolean) => {
		for await (const bytes of stream) {
			const text = decoder.decode(bytes, { stream: true });
			if (capture) stderrTail = (stderrTail + text).slice(-2000);
			onLog(text);
		}
	};

	await Promise.all([pump(proc.stdout, false), pump(proc.stderr, true)]);
	const code = await proc.exited;
	if (code !== 0) {
		const tail = stderrTail.trim().split('\n').slice(-3).join(' ');
		throw new Error(`git clone failed (exit ${code})${tail ? `: ${tail}` : ''}`);
	}
}
