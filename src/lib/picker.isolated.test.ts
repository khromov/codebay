import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the DB at a throwaway dir *before* importing anything that pulls in
// db.server (config.server reads DATA_DIR at module-eval time, and db.server
// opens the connection on import). picker.server imports db.server transitively.
const dataDir = mkdtempSync(join(tmpdir(), 'dcm-picker-'));
process.env.DATA_DIR = dataDir;

const picker = await import('./picker.server.ts');
const db = await import('./db.server.ts');

// A real directory tree to browse into.
const root = mkdtempSync(join(tmpdir(), 'dcm-browse-'));
const sub = join(root, 'project');
mkdirSync(sub, { recursive: true });

// NB: do not rmSync(dataDir) — db.server pins its connection to globalThis, so
// when multiple isolated test files run together the live DB may be backed by
// this dir; deleting it out from under the shared connection causes disk-I/O
// errors in sibling tests. The OS reaps the tmp dir anyway.
afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('browse persists and recalls the last viewed folder', () => {
	test('browsing a folder persists it under last_viewed_folder', async () => {
		const result = await picker.browse(sub);
		expect(result.path).toBe(sub);
		expect(db.getOption('last_viewed_folder')).toBe(sub);
	});

	test('browse() with no path resumes at the last viewed folder', async () => {
		await picker.browse(sub);
		const result = await picker.browse();
		expect(result.path).toBe(sub);
	});

	test('browse() falls back to home when the saved folder no longer exists', async () => {
		db.setOption('last_viewed_folder', join(root, 'gone-missing'));
		const result = await picker.browse();
		expect(result.path).toBe(homedir());
		// and the fallback target is now what gets persisted
		expect(db.getOption('last_viewed_folder')).toBe(homedir());
	});
});
