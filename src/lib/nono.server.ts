import { getOption } from './db.server.ts';
import {
	expandTilde,
	extractScriptPath,
	readHostClaudeSettings
} from '../container-injections/claude-statusline.ts';
import { claudePermissionFlags, type ClaudePermissionMode } from '../types.ts';

/**
 * The `always-further` namespace this pack shipped under has migrated to `nolabs-ai`; both still
 * resolve, but only the latter is maintained. Overridable via the `nono_profile` setting.
 */
export const DEFAULT_NONO_PROFILE = 'nolabs-ai/claude';

export function getNonoProfile(): string {
	return getOption('nono_profile')?.trim() || DEFAULT_NONO_PROFILE;
}

/** Which pane of the split a session drives; the shell pane runs under the same sandbox profile. */
export type NonoPane = 'claude' | 'shell';

export function isNonoPane(value: unknown): value is NonoPane {
	return value === 'claude' || value === 'shell';
}

/**
 * `--allow-cwd` is mandatory, not a nicety: without it `nono run` opens an interactive capability
 * prompt that nothing in this flow can answer. `--no-rollback-prompt` keeps the post-exit review
 * from blocking the fallback shell the claude pane drops into.
 *
 * Every flag here is a boolean in the nono CLI — `--suppress-save-prompt` looks like it belongs
 * but takes a `<PATH>`, and passing it bare makes `nono run` exit 2 before the pane ever starts.
 */
export function nonoArgs(
	profile: string,
	pane: NonoPane,
	permissionMode: ClaudePermissionMode,
	/** Extra single-file read grants; see `hostStatusLineReadFiles`. */
	readFiles: string[] = []
): string[] {
	const base = [
		'nono',
		'run',
		'--profile',
		profile,
		'--allow-cwd',
		'--no-rollback-prompt',
		...readFiles.flatMap((file) => ['--read-file', file]),
		'--'
	];
	if (pane === 'shell') return [...base, 'bash', '-l'];
	// The trailing `exec bash -l` runs as a child of the sandboxed shell, so it inherits the
	// sandbox — mirroring the container launcher's "drop to a shell when Claude exits".
	return [...base, 'bash', '-lc', `claude ${claudePermissionFlags(permissionMode)}; exec bash -l`];
}

export function nonoAvailable(): boolean {
	return Bun.which('nono') !== null;
}

/**
 * The stock profile grants `~/.claude`, but a statusLine command typically points at a script
 * elsewhere in `$HOME` — `bash ~/statusline.sh` being the common shape. Claude Code swallows a
 * failing statusline, so without an explicit grant the bar just silently never appears.
 *
 * Granted read-only, one file, and only for the pane that runs Claude. The container path solves
 * the same problem by *copying* the script in; here the file is the user's real one, so widening
 * the sandbox by a single file beats writing into their live `~/.claude`.
 */
export async function hostStatusLineReadFiles(): Promise<string[]> {
	const settings = await readHostClaudeSettings();
	const statusLine = settings?.statusLine as { type?: string; command?: string } | undefined;
	if (statusLine?.type !== 'command' || !statusLine.command) return [];
	const token = extractScriptPath(statusLine.command);
	return token ? [expandTilde(token)] : [];
}

async function run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	return { ok: (await proc.exited) === 0, stdout, stderr };
}

/** `nono list --installed --json` shape varies by version, so match on the pack name as text. */
export async function nonoPackInstalled(profile: string): Promise<boolean> {
	const res = await run(['nono', 'list', '--installed', '--json']);
	return res.ok && res.stdout.includes(profile);
}

/**
 * Packs are never auto-fetched, and a non-TTY first run declines the install prompt rather than
 * blocking — so pulling up front is what keeps the first boot from failing on a missing profile.
 */
export async function nonoPull(
	profile: string,
	log: (msg: string) => void
): Promise<{ ok: boolean; error?: string }> {
	if (await nonoPackInstalled(profile)) {
		log(`✓ nono profile ${profile} already installed\n`);
		return { ok: true };
	}
	log(`Pulling nono profile ${profile}…\n`);
	const res = await run(['nono', 'pull', profile]);
	if (res.stdout.trim()) log(res.stdout);
	if (!res.ok) {
		const error = res.stderr.trim() || `nono pull ${profile} failed`;
		return { ok: false, error };
	}
	log(`✓ nono profile ${profile} installed\n`);
	return { ok: true };
}
