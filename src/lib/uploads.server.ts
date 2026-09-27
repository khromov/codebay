import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import { basename, join, posix, resolve, sep } from 'node:path';
import { Mochi, apiError, json, type MochiRouteValue } from 'mochi-framework';
import { getInstance, getOption, type InstanceRow } from './db.server.ts';

export const UPLOAD_ENABLED_KEY = 'workspace_upload_enabled';

/** Off until someone opts in — a write path into every workspace is not something to ship armed. */
export function uploadEnabled(): boolean {
	return getOption(UPLOAD_ENABLED_KEY) === '1';
}

/** The drop folder inside every workspace; git-excluded (MANAGER_GIT_EXCLUDES + its own .gitignore). */
export const INBOX_DIR = 'codebay-inbox';

/** App-level ceiling, independent of Bun's `maxRequestBodySize` — kept in one place so they can't drift. */
export const UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

/**
 * A bare filename only. `basename()` alone isn't enough to stop `../x` or `a/b` — a path with
 * separators would silently resolve to a different (real) name than what it looks like it means,
 * so any input `basename()` had to change is rejected outright rather than normalized.
 */
function hasControlChar(name: string): boolean {
	for (let i = 0; i < name.length; i++) {
		if (name.charCodeAt(i) < 0x20) return true;
	}
	return false;
}

export function safeUploadName(raw: string): string {
	const trimmed = raw.trim();
	const candidate = basename(trimmed);
	if (!candidate || candidate === '.' || candidate === '..' || candidate.length > 200) {
		throw new Error('invalid file name');
	}
	if (candidate !== trimmed || /[\\/]/.test(candidate) || hasControlChar(candidate)) {
		throw new Error('invalid file name');
	}
	return candidate;
}

/** `name`, then `name-1.ext`, `name-2.ext`… — the candidates `openUnique` tries in order. */
function* candidateNames(name: string): Generator<string> {
	yield name;
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let n = 1; ; n++) yield `${stem}-${n}${ext}`;
}

/**
 * Claims the first free candidate with an exclusive create, so nothing already in the inbox is ever
 * overwritten. `wx` (O_CREAT|O_EXCL) also refuses to follow a symlink — even a dangling one, which
 * an `existsSync` probe would report as free and a plain write would follow outside the workspace.
 */
export async function openUnique(
	dir: string,
	name: string
): Promise<{ name: string; path: string; file: FileHandle }> {
	for (const candidate of candidateNames(name)) {
		const path = join(dir, candidate);
		try {
			return { name: candidate, path, file: await open(path, 'wx') };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
		}
	}
	throw new Error('unreachable');
}

const INBOX_GITIGNORE = '*\n';
// Earlier builds seeded this, whose negation left the folder itself showing in `git status`.
const LEGACY_INBOX_GITIGNORE = '*\n!.gitignore\n';

/** Self-excluding, so the inbox needs no entry in `MANAGER_GIT_EXCLUDES`-derived `.git/info/exclude`. */
function seedInboxGitignore(inbox: string): void {
	const path = join(inbox, '.gitignore');
	const st = lstatSync(path, { throwIfNoEntry: false });
	if (!st) {
		try {
			writeFileSync(path, INBOX_GITIGNORE, { flag: 'wx' });
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
		}
	} else if (st.isFile() && readFileSync(path, 'utf8') === LEGACY_INBOX_GITIGNORE) {
		writeFileSync(path, INBOX_GITIGNORE);
	}
}

export interface SavedUpload {
	name: string;
	hostPath: string;
	containerPath: string;
	bytes: number;
}

/** Writes straight to the host bind mount — no `execInContainer`, no base64, no 128 KiB carrier cap. */
export async function saveUpload(
	row: InstanceRow,
	rawName: string,
	body: ReadableStream<Uint8Array> | Blob
): Promise<SavedUpload> {
	if (!existsSync(row.workspace_path)) throw new Error('Workspace folder is not on disk yet');
	if (!row.remote_workspace_folder) throw new Error('Instance has not booted yet');
	const inbox = join(row.workspace_path, INBOX_DIR);
	// A symlinked inbox could redirect the write outside the workspace, so refuse anything but a real
	// dir — `lstat`, not `existsSync`, which reports a dangling link as absent.
	const st = lstatSync(inbox, { throwIfNoEntry: false });
	if (st && !st.isDirectory()) throw new Error(`${INBOX_DIR} is not a directory`);
	mkdirSync(inbox, { recursive: true });
	seedInboxGitignore(inbox);
	const safe = safeUploadName(rawName);
	if (!resolve(inbox, safe).startsWith(inbox + sep)) throw new Error('invalid file name'); // belt and braces
	const { name, path: dest, file } = await openUnique(inbox, safe);
	// Streamed to disk chunk by chunk, so the body never has to fit in memory.
	let written = 0;
	try {
		const stream = body instanceof Blob ? body.stream() : body;
		for await (const chunk of stream) {
			for (let off = 0; off < chunk.byteLength;) {
				off += (await file.write(chunk, off)).bytesWritten;
			}
			written += chunk.byteLength;
		}
	} catch (err) {
		// An aborted or over-cap body would otherwise leave a truncated file that looks complete.
		await file.close();
		await unlink(dest);
		throw err;
	}
	await file.close();
	return {
		name,
		hostPath: dest,
		bytes: written,
		// posix.join, never `join` — the container path is POSIX even when the host is Windows.
		containerPath: posix.join(row.remote_workspace_folder, INBOX_DIR, name)
	};
}

/**
 * Raw body + `?name=` rather than multipart: nothing to parse, and the bytes stream straight to
 * disk. Spread into the route table like `proxyRoutes`/`mcpRoutes`, and kept off `routes.ts`'s own
 * `mutationRoute` helper (which always answers 200) because this needs 404 and 413.
 */
export const uploadRoutes: Record<string, MochiRouteValue> = {
	'/api/instances/:id/upload': Mochi.api(async ({ method, params, url, request }) => {
		if (method !== 'POST') return apiError(405, 'Method Not Allowed');
		if (!uploadEnabled()) return apiError(404, 'Not Found');
		const row = getInstance(params.id!);
		if (!row) return apiError(404, 'Instance not found');
		const len = Number(request.headers.get('content-length') ?? '0');
		if (len > UPLOAD_MAX_BYTES) return apiError(413, `File exceeds ${UPLOAD_MAX_BYTES} bytes`);
		if (!request.body) return apiError(400, 'Empty body');
		try {
			const saved = await saveUpload(row, url.searchParams.get('name') ?? '', request.body);
			return json({ file: saved }, { status: 201 });
		} catch (err) {
			return apiError(400, (err as Error).message);
		}
	})
};
