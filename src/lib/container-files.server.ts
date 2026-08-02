import { checkPresence, execInContainer, type ExecTarget } from './exec.server.ts';

/**
 * A file inside a container, addressed by a shell expr for its dir (`$h` = the exec user's home) + name.
 * Every field is interpolated into a bash script, so callers must pass literal, trusted values only.
 */
export interface ContainerFile {
	/** Shell expr for the containing dir; `$h` is bound to the resolved home. Defaults to `$h`. */
	dir?: string;
	name: string;
	/** chmod mode applied on write. */
	mode?: string;
}

/** Resolves the exec user's home the same way every injection historically has. */
const HOME_PRELUDE = 'h=$(eval echo ~$(id -un)); ';

const filePath = (file: ContainerFile): string => `${file.dir ?? '$h'}/${file.name}`;

/** The two rc files either shell may open, so an interactive-shell tweak must reach both. */
export const SHELL_RC_FILES: ContainerFile[] = [{ name: '.bashrc' }, { name: '.zshrc' }];

/** `bash -lc` runs profile scripts whose stdout precedes ours, so reads mark where real output starts. */
const READ_MARKER = '__CODEBAY_READ__';

export function readFileScript(file: ContainerFile): string {
	// A status char follows the marker: A(bsent), O(k)+content, E (exists but unreadable).
	return (
		`${HOME_PRELUDE}f="${filePath(file)}"; ` +
		`if [ ! -e "$f" ]; then printf '%sA' '${READ_MARKER}'; ` +
		`elif c=$(cat "$f" 2>/dev/null); then printf '%sO%s' '${READ_MARKER}' "$c"; ` +
		`else printf '%sE' '${READ_MARKER}'; fi`
	);
}

type ContainerRead = { ok: true; content: string | null } | { ok: false; error: string };

/** Slices `readFileScript` output at the marker, so profile noise can't masquerade as file content. */
export function parseReadScriptOutput(stdout: string, name: string): ContainerRead {
	const at = stdout.indexOf(READ_MARKER);
	if (at === -1) return { ok: false, error: `read of ${name} produced no marker` };
	const payload = stdout.slice(at + READ_MARKER.length);
	if (payload[0] === 'A') return { ok: true, content: null };
	if (payload[0] === 'O') return { ok: true, content: payload.slice(1) };
	return { ok: false, error: `${name} exists but is unreadable` };
}

export function writeFileScript(file: ContainerFile): string {
	const mode = file.mode ?? '644';
	// `set -e` so a partial write can't exit 0 and get reported as a success.
	return (
		`set -e; ${HOME_PRELUDE}f="${filePath(file)}"; mkdir -p "$(dirname "$f")"; ` +
		`printf '%s' "$CODEBAY_STDIN" > "$f"; chmod ${mode} "$f"`
	);
}

/** Single-quotes a value for a sourced shell file so whatever it contains stays literal. */
export const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Lines arrive as `$@` so none is interpolated into the loop body; each file gets a `grep -qF` guard. */
export function appendLinesScript(files: ContainerFile[]): string {
	const paths = files.map((f) => `"${filePath(f)}"`).join(' ');
	// `set -e` so a failed append (readonly fs, perms) can't exit 0 and get reported as a success.
	return (
		`set -e; ${HOME_PRELUDE}for line in "$@"; do ` +
		`for f in ${paths}; do ` +
		`mkdir -p "$(dirname "$f")"; ` +
		`grep -qF "$line" "$f" 2>/dev/null || printf '%s\\n' "$line" >> "$f"; ` +
		`done; done`
	);
}

/** Read that distinguishes "absent" (`content: null`) from "couldn't read" (`ok: false`). */
export async function readContainerFileResult(
	target: ExecTarget,
	file: ContainerFile
): Promise<ContainerRead> {
	const res = await execInContainer(target, { script: readFileScript(file), capture: true });
	if (!res.ok) return { ok: false, error: res.error ?? `read of ${file.name} failed` };
	return parseReadScriptOutput(res.stdout, file.name);
}

/** Returns the file's contents, or null when it's absent, empty, or unreadable. Note: output capture trims trailing whitespace (incl. trailing newlines), so a whitespace-only file reads as null — fine for JSON callers, but don't use this where exact bytes matter. */
export async function readContainerFile(
	target: ExecTarget,
	file: ContainerFile
): Promise<string | null> {
	const res = await readContainerFileResult(target, file);
	return res.ok && res.content ? res.content : null;
}

export async function writeContainerFile(
	target: ExecTarget,
	file: ContainerFile,
	content: string
): Promise<{ ok: boolean; error?: string }> {
	const res = await execInContainer(target, { script: writeFileScript(file), stdin: content });
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Appends each line to every file it's missing from — the shared idempotent rc/conf write. */
export async function appendLinesIfAbsent(
	target: ExecTarget,
	files: ContainerFile[],
	lines: string[]
): Promise<{ ok: boolean; error?: string }> {
	if (!lines.length) return { ok: true };
	const res = await execInContainer(target, {
		script: appendLinesScript(files),
		args: ['append-lines', ...lines]
	});
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** A line counts as present when any listed file carries it — the either-rc-file check the injections have always used. */
export function linesPresentScript(files: ContainerFile[]): string {
	const greps = files.map((f) => `grep -qF "$line" "${filePath(f)}" 2>/dev/null`).join(' || ');
	return `${HOME_PRELUDE}for line in "$@"; do ${greps} || { echo 0; exit 0; }; done; echo 1`;
}

/** The `check()` counterpart of `appendLinesIfAbsent`. */
export function linesPresent(
	target: ExecTarget,
	files: ContainerFile[],
	lines: string[]
): Promise<boolean> {
	return checkPresence(target, linesPresentScript(files), ['lines-present', ...lines]);
}

/** True when the file exists and is non-empty — a content-free probe for `check()`. */
export function containerFileExists(target: ExecTarget, file: ContainerFile): Promise<boolean> {
	return checkPresence(
		target,
		`${HOME_PRELUDE}f="${filePath(file)}"; [ -s "$f" ] && echo 1 || echo 0`
	);
}

/** `$HOME`-addressed so the write, the `check()` probe, and the sourced rc line all resolve one path. */
export const shellEnvFile = (name: string): ContainerFile => ({ dir: '$HOME', name, mode: '600' });

/** Writes a mode-600 env file in the home dir and guards a source line into both rc files. */
export async function installShellEnvFile(
	target: ExecTarget,
	name: string,
	content: string
): Promise<{ ok: boolean; error?: string }> {
	const wrote = await writeContainerFile(target, shellEnvFile(name), content);
	if (!wrote.ok) return wrote;
	const path = `$HOME/${name}`;
	return appendLinesIfAbsent(target, SHELL_RC_FILES, [`[ -f "${path}" ] && . "${path}"`]);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Mirrors jq's `.[0] * .[1]`: recurse into plain objects, replace arrays and scalars with the patch. */
export function deepMerge<T extends Record<string, unknown> = Record<string, unknown>>(
	base: Record<string, unknown>,
	patch: Record<string, unknown>
): T {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		// A `__proto__` key in parsed JSON would pollute Object.prototype via plain assignment.
		if (key === '__proto__') continue;
		const current = out[key];
		out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
	}
	return out as T;
}

type JsonRead = { ok: true; data: Record<string, unknown> | null } | { ok: false; error: string };

/** Absent/empty means "start fresh"; anything else must parse to an object, so callers can refuse destructive fallbacks. */
export function parseJsonRead(raw: string | null, name: string): JsonRead {
	if (raw === null || raw === '') return { ok: true, data: null };
	try {
		const data: unknown = JSON.parse(raw);
		if (!isPlainObject(data)) return { ok: false, error: `${name} is not a JSON object` };
		return { ok: true, data };
	} catch {
		return { ok: false, error: `${name} exists but is not valid JSON` };
	}
}

/** Parses the container file, treating an absent or invalid file as "no JSON" (null). */
export async function readJsonFile<T = Record<string, unknown>>(
	target: ExecTarget,
	file: ContainerFile
): Promise<T | null> {
	const parsed = parseJsonRead(await readContainerFile(target, file), file.name);
	return parsed.ok ? (parsed.data as T | null) : null;
}

export async function writeJsonFile(
	target: ExecTarget,
	file: ContainerFile,
	data: unknown
): Promise<{ ok: boolean; error?: string }> {
	return writeContainerFile(target, file, JSON.stringify(data, null, 2));
}

/**
 * Read-modify-write: an absent/empty file starts from `{}`, but a failed read or unparseable
 * existing content aborts the edit — overwriting what we couldn't read would silently destroy it.
 */
export async function editJsonFile(
	target: ExecTarget,
	file: ContainerFile,
	edit: (current: Record<string, unknown>) => Record<string, unknown> | void
): Promise<{ ok: boolean; error?: string }> {
	const read = await readContainerFileResult(target, file);
	if (!read.ok) return { ok: false, error: `read before edit failed: ${read.error}` };
	const parsed = parseJsonRead(read.content, file.name);
	if (!parsed.ok) return { ok: false, error: parsed.error };
	const current = parsed.data ?? {};
	const next = edit(current) ?? current;
	return writeJsonFile(target, file, next);
}
