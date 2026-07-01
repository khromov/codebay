import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getOption, setOption } from './db.server';

/** Options key under which the last browsed folder is persisted. */
const LAST_VIEWED_FOLDER = 'last_viewed_folder';

export interface DirEntry {
	name: string;
	path: string;
	hasDevcontainer: boolean;
}

export interface BrowseResult {
	/** Absolute path being listed. */
	path: string;
	/** Whether `path` itself contains a devcontainer.json. */
	hasDevcontainer: boolean;
	/** Parent directory, or null when at the filesystem root. */
	parent: string | null;
	/** Subdirectories of `path`, sorted, hidden dirs excluded. */
	entries: DirEntry[];
}

function hasDevcontainer(dir: string): boolean {
	return (
		existsSync(join(dir, '.devcontainer', 'devcontainer.json')) ||
		existsSync(join(dir, '.devcontainer.json'))
	);
}

/**
 * List the subdirectories of `path` so the web UI can browse to and pick a project
 * folder. Only directories are returned — all we need from the selection is the
 * absolute path. When no `path` is given the picker resumes at the last browsed
 * folder (persisted across sessions), falling back to the user's home directory.
 * The viewed folder is continuously persisted so the next visit reopens there.
 */
export async function browse(path?: string): Promise<BrowseResult> {
	let target: string;
	if (path && path.trim()) {
		target = path;
	} else {
		const saved = getOption(LAST_VIEWED_FOLDER);
		target = saved && existsSync(saved) ? saved : homedir();
	}

	const info = await stat(target);
	if (!info.isDirectory()) throw new Error(`Not a folder: ${target}`);

	const dirents = await readdir(target, { withFileTypes: true });
	const entries: DirEntry[] = [];
	for (const dirent of dirents) {
		if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
		const full = join(target, dirent.name);
		entries.push({ name: dirent.name, path: full, hasDevcontainer: hasDevcontainer(full) });
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));

	setOption(LAST_VIEWED_FOLDER, target);

	const parent = dirname(target);
	return {
		path: target,
		hasDevcontainer: hasDevcontainer(target),
		parent: parent === target ? null : parent,
		entries
	};
}
