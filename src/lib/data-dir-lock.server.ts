import { mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** How often a live manager refreshes the lock, and how long a silent one keeps it. */
export const LOCK_HEARTBEAT_MS = 5_000;
export const LOCK_STALE_MS = 30_000;

export const LOCK_FILE = 'manager.lock';

export interface LockHolder {
	pid: number;
	host: string;
	startedAt: number;
}

export type LockResult =
	{ ok: true; release: () => void } | { ok: false; holder: LockHolder | null; path: string };

// Pinned so a dev-mode re-evaluation of the entry module re-uses the heartbeat instead of stacking one.
const globalForLock = globalThis as unknown as { __codebayDataDirLock?: LockResult };

/**
 * One manager per DATA_DIR. Two of them share the DB and both poll every run, so each folds only
 * the stream chunks it fetched itself and whichever sees the exit file finishes the row from a
 * partial state. Liveness is the file's mtime under a heartbeat rather than a pid check: pids
 * don't cross a container boundary and get reused after a reboot, but a stale file just ages out.
 */
export function acquireDataDirLock(dir: string, now = Date.now()): LockResult {
	if (globalForLock.__codebayDataDirLock?.ok) return globalForLock.__codebayDataDirLock;
	const path = join(dir, LOCK_FILE);
	const existing = readLock(path);
	if (existing && now - existing.mtimeMs < LOCK_STALE_MS && existing.holder?.pid !== process.pid) {
		return { ok: false, holder: existing.holder, path };
	}
	mkdirSync(dir, { recursive: true });
	const holder: LockHolder = { pid: process.pid, host: hostname(), startedAt: now };
	writeFileSync(path, JSON.stringify(holder) + '\n');
	const timer = setInterval(() => {
		try {
			const at = new Date();
			utimesSync(path, at, at);
		} catch {
			// The data dir went away underneath us; there is nothing left to keep alive.
		}
	}, LOCK_HEARTBEAT_MS);
	// A heartbeat must never be the reason the process stays up.
	timer.unref?.();
	const result: LockResult = {
		ok: true,
		release: () => {
			clearInterval(timer);
			globalForLock.__codebayDataDirLock = undefined;
			try {
				if (readLock(path)?.holder?.pid === process.pid) unlinkSync(path);
			} catch {
				// Already gone, or not ours any more.
			}
		}
	};
	globalForLock.__codebayDataDirLock = result;
	return result;
}

function readLock(path: string): { holder: LockHolder | null; mtimeMs: number } | null {
	try {
		const mtimeMs = statSync(path).mtimeMs;
		let holder: LockHolder | null = null;
		try {
			holder = JSON.parse(readFileSync(path, 'utf8')) as LockHolder;
		} catch {
			// Garbage in the file still counts as a lock while it is fresh.
		}
		return { holder, mtimeMs };
	} catch {
		return null;
	}
}
