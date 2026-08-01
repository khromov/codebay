import { checkPresence, execInContainer, type ExecTarget } from './exec.server.ts';

/** A file inside a container, addressed by a shell expr for its dir (`$h` = the exec user's home) + name. */
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

export function readFileScript(file: ContainerFile): string {
	// `|| true` so an absent file is an empty read, not a non-zero exit.
	return `${HOME_PRELUDE}f="${filePath(file)}"; cat "$f" 2>/dev/null || true`;
}

export function writeFileScript(file: ContainerFile): string {
	const mode = file.mode ?? '644';
	return (
		`${HOME_PRELUDE}f="${filePath(file)}"; mkdir -p "$(dirname "$f")"; ` +
		`printf '%s' "$CODEBAY_STDIN" > "$f"; chmod ${mode} "$f"`
	);
}

/** Single-quotes a value for a sourced shell file so whatever it contains stays literal. */
export const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Lines arrive as `$@` so none is interpolated into the loop body; each file gets a `grep -qF` guard. */
export function appendLinesScript(files: ContainerFile[]): string {
	const paths = files.map((f) => `"${filePath(f)}"`).join(' ');
	return (
		`${HOME_PRELUDE}for line in "$@"; do ` +
		`for f in ${paths}; do ` +
		`mkdir -p "$(dirname "$f")"; ` +
		`grep -qF "$line" "$f" 2>/dev/null || printf '%s\\n' "$line" >> "$f"; ` +
		`done; done`
	);
}

/** Returns the file's contents, or null when it's absent or empty. Note: `execInContainer` trims captured output, so leading/trailing whitespace (incl. trailing newlines) is stripped and a whitespace-only file reads as null — fine for JSON callers, but don't use this where exact bytes matter. */
export async function readContainerFile(
	target: ExecTarget,
	file: ContainerFile
): Promise<string | null> {
	const res = await execInContainer(target, { script: readFileScript(file), capture: true });
	if (!res.ok || res.stdout === '') return null;
	return res.stdout;
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
export async function containerFileExists(
	target: ExecTarget,
	file: ContainerFile
): Promise<boolean> {
	const res = await execInContainer(target, {
		script: `${HOME_PRELUDE}f="${filePath(file)}"; [ -s "$f" ] && echo 1 || echo 0`,
		capture: true
	});
	return res.ok && res.stdout === '1';
}

/** Writes a mode-600 env file in the home dir and guards a source line into both rc files. */
export async function installShellEnvFile(
	target: ExecTarget,
	name: string,
	content: string
): Promise<{ ok: boolean; error?: string }> {
	const wrote = await writeContainerFile(target, { name, mode: '600' }, content);
	if (!wrote.ok) return wrote;
	// Sourced from `$HOME` so the line stays portable and matches on every re-apply.
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
	const read = await execInContainer(target, { script: readFileScript(file), capture: true });
	if (!read.ok) return { ok: false, error: `read before edit failed: ${read.error}` };
	const parsed = parseJsonRead(read.stdout, file.name);
	if (!parsed.ok) return { ok: false, error: parsed.error };
	const current = parsed.data ?? {};
	const next = edit(current) ?? current;
	return writeJsonFile(target, file, next);
}
