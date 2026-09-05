import { execInContainer, type ExecTarget } from './exec.server.ts';
import { SOURCE_INJECTED_ENV } from './devcontainer.server.ts';
import { getOption, type InstanceRow } from './db.server.ts';
import { HOME_PRELUDE, shellSingleQuote as quote } from './container-files.server.ts';

/** Enough for a big diff or a test run's output, small enough not to blow a caller's context. */
export const OUTPUT_CAP = 200_000;

const CODE_MARKER = '__CODEBAY_CMD__';
const OUT_MARKER = '__CODEBAY_CMD_OUT__';
const ERR_MARKER = '__CODEBAY_CMD_ERR__';
const END_MARKER = '__CODEBAY_CMD_END__';

/** `timeout`'s own exit code for a command it had to kill. */
const TIMEOUT_EXIT = 124;

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	truncated: boolean;
}

function target(row: InstanceRow): ExecTarget {
	return { containerId: row.container_id!, remoteUser: row.remote_user };
}

/** Everything here runs from the workspace, since an exec only inherits the image's WorkingDir. */
function workspacePrelude(row: InstanceRow): string {
	const cd = row.remote_workspace_folder
		? `cd ${quote(row.remote_workspace_folder)} || exit 1; `
		: '';
	return `${HOME_PRELUDE}[ -n "$HOME" ] || export HOME="$h"; ${cd}`;
}

function decodeBlock(stdout: string, marker: string): string {
	const at = stdout.indexOf(marker);
	if (at === -1) return '';
	const rest = stdout.slice(at + marker.length);
	const end = rest.indexOf(END_MARKER);
	// GNU base64 wraps at 76 columns, and a trimmed capture can drop the final newline.
	const b64 = (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, '');
	return b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
}

function cap(text: string): { text: string; truncated: boolean } {
	return text.length > OUTPUT_CAP
		? { text: text.slice(0, OUTPUT_CAP) + '\n… output truncated', truncated: true }
		: { text, truncated: false };
}

/**
 * Runs an arbitrary command in the sandbox and captures both streams separately.
 *
 * The command rides in through `execInContainer`'s stdin carrier rather than the script body, so
 * nothing has to be escaped and it never reaches the container's process list. Output is base64'd
 * because the capture path trims and the demuxed stream is text — the same reason log capture does.
 */
export async function execCommand(
	row: InstanceRow,
	command: string,
	opts: { timeoutSeconds?: number; cwd?: string } = {}
): Promise<CommandResult> {
	const seconds = Math.max(1, Math.min(opts.timeoutSeconds ?? 120, 3600));
	const script =
		workspacePrelude(row) +
		SOURCE_INJECTED_ENV +
		`o=$(mktemp); e=$(mktemp); ` +
		// The in-container `timeout` is what actually kills the process; execInContainer's own
		// timeoutMs below is only a backstop for a wedged docker stream.
		`if command -v timeout >/dev/null 2>&1; then timeout -k 5 ${seconds} bash -c "$CODEBAY_STDIN" >"$o" 2>"$e"; ` +
		`else bash -c "$CODEBAY_STDIN" >"$o" 2>"$e"; fi; c=$?; ` +
		`printf '${CODE_MARKER}%s\\n' "$c"; ` +
		`printf '${OUT_MARKER}\\n'; base64 < "$o"; printf '\\n${END_MARKER}\\n'; ` +
		`printf '${ERR_MARKER}\\n'; base64 < "$e"; printf '\\n${END_MARKER}\\n'; ` +
		`rm -f "$o" "$e"; true`;

	const res = await execInContainer(target(row), {
		script,
		stdin: opts.cwd ? `cd ${quote(opts.cwd)} || exit 1\n${command}` : command,
		capture: true,
		timeoutMs: (seconds + 15) * 1000
	});
	if (!res.ok) {
		return {
			exitCode: -1,
			stdout: '',
			stderr: res.error ?? 'the command could not be run',
			timedOut: false,
			truncated: false
		};
	}

	const codeAt = res.stdout.lastIndexOf(CODE_MARKER);
	const exitCode =
		codeAt === -1
			? -1
			: Number.parseInt(
					res.stdout
						.slice(codeAt + CODE_MARKER.length)
						.split('\n')[0]!
						.trim(),
					10
				);
	const out = cap(decodeBlock(res.stdout, OUT_MARKER));
	const err = cap(decodeBlock(res.stdout, ERR_MARKER));
	return {
		exitCode: Number.isFinite(exitCode) ? exitCode : -1,
		stdout: out.text,
		stderr: err.text,
		timedOut: exitCode === TIMEOUT_EXIT,
		truncated: out.truncated || err.truncated
	};
}

/** Throws the command's own stderr, so a tool caller sees why git or gh refused. */
async function must(row: InstanceRow, command: string, timeoutSeconds = 120): Promise<string> {
	const res = await execCommand(row, command, { timeoutSeconds });
	if (res.exitCode !== 0) {
		throw new Error((res.stderr || res.stdout || `command failed (exit ${res.exitCode})`).trim());
	}
	return res.stdout;
}

/**
 * The path arrives as an argv entry rather than spliced into the script, so no amount of quoting
 * in a caller-supplied filename can escape into the shell.
 */
export async function readWorkspaceFile(row: InstanceRow, path: string): Promise<string> {
	const script =
		workspacePrelude(row) +
		`if [ ! -f "$1" ]; then printf '${CODE_MARKER}1\\n'; exit 0; fi; ` +
		`printf '${CODE_MARKER}0\\n'; printf '${OUT_MARKER}\\n'; base64 < "$1"; printf '\\n${END_MARKER}\\n'`;
	const res = await execInContainer(target(row), {
		script,
		args: ['read-file', path],
		capture: true,
		timeoutMs: 30_000
	});
	if (!res.ok) throw new Error(res.error ?? 'could not read the file');
	if (res.stdout.includes(`${CODE_MARKER}1`)) throw new Error(`no such file: ${path}`);
	return cap(decodeBlock(res.stdout, OUT_MARKER)).text;
}

export async function writeWorkspaceFile(
	row: InstanceRow,
	path: string,
	content: string
): Promise<void> {
	const script =
		workspacePrelude(row) +
		`set -e; mkdir -p "$(dirname "$1")"; printf '%s' "$CODEBAY_STDIN" | base64 -d > "$1"`;
	const res = await execInContainer(target(row), {
		script,
		args: ['write-file', path],
		stdin: Buffer.from(content, 'utf8').toString('base64'),
		timeoutMs: 30_000
	});
	if (!res.ok) throw new Error(res.error ?? 'could not write the file');
}

export interface DiffResult {
	diff: string;
	status: string;
	branch: string;
	truncated: boolean;
}

/** `--stat`-free full patch plus a porcelain summary, which is what an agent usually wants next. */
export async function gitDiff(
	row: InstanceRow,
	opts: { base?: string; staged?: boolean } = {}
): Promise<DiffResult> {
	const range = opts.base ? ` ${quote(opts.base)}...HEAD` : opts.staged ? ' --staged' : '';
	const [diff, status, branch] = await Promise.all([
		execCommand(row, `git --no-pager diff${range}`),
		execCommand(row, 'git status --short'),
		execCommand(row, 'git rev-parse --abbrev-ref HEAD')
	]);
	if (diff.exitCode !== 0) throw new Error((diff.stderr || 'git diff failed').trim());
	return {
		diff: diff.stdout,
		status: status.stdout,
		branch: branch.stdout.trim(),
		truncated: diff.truncated
	};
}

export interface PushResult {
	branch: string;
	committed: boolean;
	output: string;
}

/**
 * The `github-credentials` injection has already authed git and `gh` inside the container, so this
 * is a plain push — nothing here handles credentials.
 */
export async function gitPush(
	row: InstanceRow,
	opts: { branch?: string; commitMessage?: string; force?: boolean } = {}
): Promise<PushResult> {
	const current = (await must(row, 'git rev-parse --abbrev-ref HEAD')).trim();
	const branch = opts.branch?.trim() || current;
	if (!branch || branch === 'HEAD') {
		throw new Error('the sandbox is on a detached HEAD — pass an explicit branch');
	}

	let committed = false;
	if (opts.commitMessage) {
		const dirty = await execCommand(row, 'git status --porcelain');
		if (dirty.stdout.trim()) {
			await must(row, `git add -A && git commit -m ${quote(opts.commitMessage)}`);
			committed = true;
		}
	}

	if (current !== branch) await must(row, `git checkout -B ${quote(branch)}`);

	// --force-with-lease rather than --force: it still refuses to discard commits we never saw.
	const force = opts.force ? ' --force-with-lease' : '';
	const output = await must(
		row,
		`git push${force} -u origin HEAD:refs/heads/${quote(branch)} 2>&1`,
		300
	);
	return { branch, committed, output: output.trim() };
}

export const PR_ATTRIBUTION_KEY = 'mcp_pr_attribution';

/** The footer appended to an MCP-opened PR body when the setting is on. */
export const PR_ATTRIBUTION =
	'🤖 Written by Claude Code in a [Codebay](https://github.com/khromov/codebay) sandbox, driven over MCP.';

/** Off unless explicitly enabled — an attribution line on someone's PR is theirs to opt into. */
export function prAttributionEnabled(): boolean {
	return getOption(PR_ATTRIBUTION_KEY) === '1';
}

/** Appends the footer, unless the body already carries it (a caller may have written its own). */
export function withAttribution(body: string): string {
	if (!prAttributionEnabled() || body.includes(PR_ATTRIBUTION)) return body;
	return `${body.trimEnd()}\n\n---\n${PR_ATTRIBUTION}\n`;
}

export async function createPr(
	row: InstanceRow,
	opts: { title: string; body?: string; base?: string; draft?: boolean }
): Promise<{ url: string }> {
	const parts = [
		'gh pr create',
		`--title ${quote(opts.title)}`,
		`--body ${quote(withAttribution(opts.body ?? ''))}`
	];
	if (opts.base) parts.push(`--base ${quote(opts.base)}`);
	if (opts.draft) parts.push('--draft');
	const out = await must(row, `${parts.join(' ')} 2>&1`, 300);
	// gh prints the PR URL as its last line; anything else is progress chatter.
	const url = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
	if (!url.startsWith('http')) throw new Error(out.trim() || 'gh did not return a PR url');
	return { url };
}
