import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getOption, setOption } from './db.server';
import { findDevcontainerConfig } from './devcontainer.server.ts';
import type { BrowseResult, DirEntry } from '../types.ts';

const LAST_VIEWED_FOLDER = 'last_viewed_folder';

function hasDevcontainer(dir: string): boolean {
	return findDevcontainerConfig(dir) !== null;
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
