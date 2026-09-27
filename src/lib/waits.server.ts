import { getInstance, getRun, type AgentRunRow, type InstanceRow } from './db.server.ts';
import { resumeRuns, watchRuns } from './agent-runs.server.ts';
import { isProvisioning, triggerReconcile, watchInstances } from './instances.server.ts';

/** What a caller can block on: an agent run reaching a terminal state, or a sandbox leaving `creating`. */
export interface WaitTargets {
	runs?: string[];
	sandboxes?: string[];
}

export interface WaitOptions {
	/** `all` (the default) returns once every target has settled, `any` as soon as one has. */
	mode?: 'all' | 'any';
	timeoutMs: number;
	/** The HTTP request's or MCP call's signal, so a client that hangs up frees its waiter at once. */
	signal?: AbortSignal;
	/** Fires on every change to a watched target, settled or not, for progress reporting. */
	onChange?: (kind: 'run' | 'sandbox', id: string) => void;
}

export interface WaitOutcome {
	settled: boolean;
	timed_out: boolean;
	aborted: boolean;
	/** In the order asked for; null for a run or sandbox that has been deleted. */
	runs: { id: string; row: AgentRunRow | null }[];
	sandboxes: { id: string; row: InstanceRow | null }[];
}

/** Ceiling on one wait, so a forgotten waiter can't pin a request (and its listeners) for days. */
export const MAX_WAIT_MS = 6 * 60 * 60_000;

export function runSettled(row: AgentRunRow | null): boolean {
	return !row || (row.status !== 'queued' && row.status !== 'running');
}

export function sandboxSettled(row: InstanceRow | null): boolean {
	return !row || row.status !== 'creating';
}

function snapshot(targets: WaitTargets): Pick<WaitOutcome, 'runs' | 'sandboxes'> {
	return {
		runs: (targets.runs ?? []).map((id) => ({ id, row: getRun(id) })),
		sandboxes: (targets.sandboxes ?? []).map((id) => ({ id, row: getInstance(id) }))
	};
}

function done(state: Pick<WaitOutcome, 'runs' | 'sandboxes'>, mode: 'all' | 'any'): boolean {
	const flags = [
		...state.runs.map((r) => runSettled(r.row)),
		...state.sandboxes.map((s) => sandboxSettled(s.row))
	];
	return mode === 'any' ? flags.some(Boolean) : flags.every(Boolean);
}

/** Throws on an unknown id up front, so a typo fails fast instead of "settling" as deleted. */
export function assertWaitTargets(targets: WaitTargets): void {
	const runs = targets.runs ?? [];
	const sandboxes = targets.sandboxes ?? [];
	if (!runs.length && !sandboxes.length) throw new Error('nothing to wait for');
	for (const id of runs) if (!getRun(id)) throw new Error(`No run with id ${id}`);
	for (const id of sandboxes) if (!getInstance(id)) throw new Error(`No sandbox with id ${id}`);
}

/**
 * Blocks until the targets settle, driven entirely by the change notifications the run poller and
 * the instance lifecycle already emit — no container is exec'd on a waiter's behalf. Settled state
 * is read from SQLite, so a run that finished while nobody was listening (or before a restart)
 * returns straight away.
 */
export function waitFor(targets: WaitTargets, opts: WaitOptions): Promise<WaitOutcome> {
	assertWaitTargets(targets);
	const mode = opts.mode ?? 'all';
	const runIds = new Set(targets.runs ?? []);
	const sandboxIds = new Set(targets.sandboxes ?? []);

	const initial = snapshot(targets);
	const result = (state: typeof initial, flags: Partial<WaitOutcome>): WaitOutcome => ({
		settled: done(state, mode),
		timed_out: false,
		aborted: false,
		...state,
		...flags
	});
	if (done(initial, mode)) return Promise.resolve(result(initial, {}));
	if (opts.signal?.aborted) return Promise.resolve(result(initial, { aborted: true }));

	// The poller stops itself when no run is open; a restart may not have re-armed it yet.
	if (runIds.size) resumeRuns();
	// A `creating` row with no boot behind it was orphaned by a restart; reconcile re-derives it.
	for (const s of initial.sandboxes) {
		if (s.row?.status === 'creating' && !isProvisioning(s.id)) triggerReconcile();
	}

	return new Promise((resolve) => {
		let finished = false;
		const cleanups: (() => void)[] = [];
		const finish = (flags: Partial<WaitOutcome>) => {
			if (finished) return;
			finished = true;
			for (const cleanup of cleanups) cleanup();
			resolve(result(snapshot(targets), flags));
		};
		const recheck = () => {
			if (done(snapshot(targets), mode)) finish({});
		};

		cleanups.push(
			watchRuns((runId) => {
				if (!runIds.has(runId)) return;
				opts.onChange?.('run', runId);
				recheck();
			})
		);
		if (sandboxIds.size) {
			cleanups.push(
				watchInstances((id) => {
					if (id !== undefined && !sandboxIds.has(id)) return;
					if (id !== undefined) opts.onChange?.('sandbox', id);
					recheck();
				})
			);
		}

		const timer = setTimeout(
			() => finish({ timed_out: true }),
			Math.min(Math.max(opts.timeoutMs, 0), MAX_WAIT_MS)
		);
		cleanups.push(() => clearTimeout(timer));

		if (opts.signal) {
			const onAbort = () => finish({ aborted: true });
			opts.signal.addEventListener('abort', onAbort, { once: true });
			cleanups.push(() => opts.signal!.removeEventListener('abort', onAbort));
		}

		// Covers a change that landed between the initial snapshot and the listeners going on.
		recheck();
	});
}
