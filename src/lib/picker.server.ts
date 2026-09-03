import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { getOption, setOption } from './db.server';
import { findDevcontainerConfig } from './devcontainer.server.ts';
import { DRIVES_ROOT } from './drives.ts';
import type { BrowseResult, DirEntry } from '../types.ts';

const LAST_VIEWED_FOLDER = 'last_viewed_folder';

const isWindows = process.platform === 'win32';

function hasDevcontainer(dir: string): boolean {
	return findDevcontainerConfig(dir) !== null;
}

/** Probed rather than enumerated, so listing the drives needs no shell-out. */
function driveRoots(): DirEntry[] {
	const roots: DirEntry[] = [];
	for (let i = 0; i < 26; i++) {
		const path = `${String.fromCharCode(65 + i)}:${sep}`;
		if (existsSync(path)) roots.push({ name: path, path, hasDevcontainer: hasDevcontainer(path) });
	}
	return roots;
}

/** Persists every folder it lists, so an argument-less call resumes where the user left off. */
export async function browse(path?: string): Promise<BrowseResult> {
	let target: string;
	if (path && path.trim()) {
		target = path;
	} else {
		const saved = getOption(LAST_VIEWED_FOLDER);
		target = saved && existsSync(saved) ? saved : homedir();
	}

	// Deliberately not persisted as the last-viewed folder: it is not a real directory, so a
	// resume would fall through to the home dir anyway.
	if (isWindows && target === DRIVES_ROOT) {
		return { path: DRIVES_ROOT, hasDevcontainer: false, parent: null, entries: driveRoots() };
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
		// A Windows drive root is its own dirname, which would otherwise strand the user on
		// whichever drive their home directory sits on.
		parent: parent === target ? (isWindows ? DRIVES_ROOT : null) : parent,
		entries
	};
}
