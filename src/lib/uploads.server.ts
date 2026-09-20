import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
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

/** Picks `name`, then `name-1.ext`, `name-2.ext`… so nothing already in the inbox is ever overwritten. */
export function uniqueName(dir: string, name: string): string {
	if (!existsSync(join(dir, name))) return name;
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let n = 1; ; n++) {
		const candidate = `${stem}-${n}${ext}`;
		if (!existsSync(join(dir, candidate))) return candidate;
	}
}

/** Self-excluding, so the inbox needs no entry in `MANAGER_GIT_EXCLUDES`-derived `.git/info/exclude`. */
function seedInboxGitignore(inbox: string): void {
	const path = join(inbox, '.gitignore');
	if (existsSync(path)) return;
	writeFileSync(path, '*\n!.gitignore\n');
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
	// A symlinked inbox could redirect the write outside the workspace, so refuse anything but a real dir.
	if (existsSync(inbox) && !lstatSync(inbox).isDirectory()) {
		throw new Error(`${INBOX_DIR} is not a directory`);
	}
	mkdirSync(inbox, { recursive: true });
	seedInboxGitignore(inbox);
	const name = uniqueName(inbox, safeUploadName(rawName));
	const dest = resolve(inbox, name);
	if (!dest.startsWith(inbox + sep)) throw new Error('invalid file name'); // belt and braces
	// Streamed to disk; the body never has to fit in memory. Kept as two calls rather than one with
	// a `Blob | Response` argument — Bun's overloads don't resolve against that union.
	const written =
		body instanceof Blob ? await Bun.write(dest, body) : await Bun.write(dest, new Response(body));
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
