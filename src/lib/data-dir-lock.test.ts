import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	LOCK_FILE,
	LOCK_STALE_MS,
	acquireDataDirLock,
	type LockResult
} from './data-dir-lock.server.ts';

const dirs: string[] = [];
const held: LockResult[] = [];

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-lock-'));
	dirs.push(dir);
	return dir;
}

/** A lock left by some other manager, `ageMs` ago. */
function foreignLock(dir: string, ageMs: number, pid = process.pid + 1): void {
	const path = join(dir, LOCK_FILE);
	writeFileSync(path, JSON.stringify({ pid, host: 'elsewhere', startedAt: Date.now() - ageMs }));
	const at = new Date(Date.now() - ageMs);
	utimesSync(path, at, at);
}

afterEach(() => {
	for (const lock of held.splice(0)) if (lock.ok) lock.release();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('acquireDataDirLock', () => {
	test('takes an unlocked data dir and records who holds it', () => {
		const dir = join(scratch(), 'state');
		const lock = acquireDataDirLock(dir);
		held.push(lock);
		expect(lock.ok).toBe(true);
		const holder = JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'));
		expect(holder.pid).toBe(process.pid);
	});

	test('refuses a data dir another live manager holds, naming it', () => {
		const dir = scratch();
		foreignLock(dir, 1_000, 4242);
		const lock = acquireDataDirLock(dir);
		held.push(lock);
		expect(lock.ok).toBe(false);
		if (!lock.ok) {
			expect(lock.holder?.pid).toBe(4242);
			expect(lock.path).toBe(join(dir, LOCK_FILE));
		}
	});

	test('takes over a lock whose heartbeat stopped, so a crash never wedges the next boot', () => {
		const dir = scratch();
		foreignLock(dir, LOCK_STALE_MS + 1_000);
		const lock = acquireDataDirLock(dir);
		held.push(lock);
		expect(lock.ok).toBe(true);
		expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(process.pid);
	});

	test('a fresh but unreadable lock still counts, since something is clearly alive there', () => {
		const dir = scratch();
		writeFileSync(join(dir, LOCK_FILE), 'not json');
		const lock = acquireDataDirLock(dir);
		held.push(lock);
		expect(lock.ok).toBe(false);
		if (!lock.ok) expect(lock.holder).toBeNull();
	});

	test('release removes the file, and only when it is still ours', () => {
		const dir = scratch();
		const lock = acquireDataDirLock(dir);
		expect(lock.ok).toBe(true);
		if (!lock.ok) return;
		lock.release();
		expect(existsSync(join(dir, LOCK_FILE))).toBe(false);

		const again = acquireDataDirLock(dir);
		expect(again.ok).toBe(true);
		if (!again.ok) return;
		foreignLock(dir, 0);
		again.release();
		expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
	});
});
