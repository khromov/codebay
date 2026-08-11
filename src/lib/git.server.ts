import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGhToken } from '../container-injections/github-credentials.ts';
import { parseRepoUrl } from './repo-url.ts';

/** Reads the bind-mounted host copy, so polling the container's branch costs no `docker exec`. */
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

/** Exit-code probe — `spawnCapture` can't tell a silent success from a failure. */
async function gitExitCode(workspaceDir: string, args: string[]): Promise<number | null> {
	try {
		const proc = Bun.spawn(['git', '-C', workspaceDir, ...args], {
			stdout: 'ignore',
			stderr: 'ignore'
		});
		return await proc.exited;
	} catch {
		return null; // no git on the host
	}
}

export async function isTrackedFile(workspaceDir: string, relPath: string): Promise<boolean> {
	return (await gitExitCode(workspaceDir, ['ls-files', '--error-unmatch', '--', relPath])) === 0;
}

export async function restoreTrackedFile(workspaceDir: string, relPath: string): Promise<boolean> {
	return (await gitExitCode(workspaceDir, ['checkout', '--', relPath])) === 0;
}

/**
 * The token goes in env-scoped git config, so it lands in neither argv nor the clone's
 * persisted `.git/config`; `GIT_TERMINAL_PROMPT=0` fails fast instead of blocking on a prompt.
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

	// Keyed by host so GitHub Enterprise Server clones authenticate too, not just github.com.
	const found = await readGhToken(parsed.host);
	if (found) {
		const basic = Buffer.from(`x-access-token:${found.token}`).toString('base64');
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = `http.https://${parsed.host}/.extraheader`;
		env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
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
