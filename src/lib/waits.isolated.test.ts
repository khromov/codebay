import { afterEach, describe, expect, test } from 'bun:test';
import {
	deleteInstanceRow,
	getRun,
	insertInstance,
	updateInstance,
	type InstanceRow
} from './db.server.ts';
import { startRun, stopRun } from './agent-runs.server.ts';
import { triggerReconcile } from './instances.server.ts';
import { waitFor } from './waits.server.ts';

/** The watcher sets are pinned to globalThis, which is exactly what a leak would grow. */
const g = globalThis as unknown as {
	__codebayRuns?: { watchers: Set<unknown> };
	__codebayInstanceWatchers?: Set<unknown>;
};
const watcherCount = () =>
	(g.__codebayRuns?.watchers.size ?? 0) + (g.__codebayInstanceWatchers?.size ?? 0);

let seq = 0;
const seeded: string[] = [];

/**
 * A `creating` instance with no container: startRun queues against it without launching, and
 * stopRun settles the row without exec'ing anything — so no docker stub is needed at all.
 */
function seed(overrides: Partial<InstanceRow> = {}): InstanceRow {
	const row: InstanceRow = {
		id: `wait-inst-${++seq}`,
		name: `wait-inst-${seq}`,
		source_path: '/src',
		workspace_path: '/ws',
		host_port: 8600 + seq,
		container_id: null,
		remote_workspace_folder: null,
		status: 'creating',
		error: null,
		created_at: Date.now(),
		bridge_token: 'tok',
		remote_user: null,
		image_source: null,
		avatar: null,
		mode: 'ide',
		terminal_split: 0,
		config_migrated: 1,
		...overrides
	};
	insertInstance(row);
	seeded.push(row.id);
	return row;
}

afterEach(() => {
	for (const id of seeded.splice(0)) deleteInstanceRow(id);
});

describe('waitFor', () => {
	test('answers at once for a run that already settled, with no listener left behind', async () => {
		const run = startRun(seed(), 'go');
		await stopRun(run.id);
		const before = watcherCount();
		const outcome = await waitFor({ runs: [run.id] }, { timeoutMs: 60_000 });
		expect(outcome).toMatchObject({ settled: true, timed_out: false, aborted: false });
		expect(outcome.runs[0]!.row?.status).toBe('cancelled');
		expect(watcherCount()).toBe(before);
	});

	test('resolves on the poller’s change notification, not on a timer', async () => {
		const run = startRun(seed(), 'go');
		const started = Date.now();
		const pending = waitFor({ runs: [run.id] }, { timeoutMs: 60_000 });
		setTimeout(() => void stopRun(run.id), 50);
		const outcome = await pending;
		expect(outcome.settled).toBe(true);
		expect(outcome.runs[0]!.row?.status).toBe('cancelled');
		expect(Date.now() - started).toBeLessThan(2000);
	});

	test('reports progress for every change to a watched run', async () => {
		const run = startRun(seed(), 'go');
		const seen: string[] = [];
		const pending = waitFor(
			{ runs: [run.id] },
			{ timeoutMs: 60_000, onChange: (kind, id) => seen.push(`${kind}:${id}`) }
		);
		await stopRun(run.id);
		await pending;
		expect(seen).toContain(`run:${run.id}`);
	});

	test('times out without settling and unregisters its listeners', async () => {
		const run = startRun(seed(), 'go');
		const before = watcherCount();
		const pending = waitFor({ runs: [run.id] }, { timeoutMs: 30 });
		expect(watcherCount()).toBe(before + 1);
		const outcome = await pending;
		expect(outcome).toMatchObject({ settled: false, timed_out: true });
		expect(outcome.runs[0]!.row?.status).toBe('queued');
		expect(watcherCount()).toBe(before);
		await stopRun(run.id);
	});

	test('a caller that hangs up frees its waiter straight away', async () => {
		const run = startRun(seed(), 'go');
		const before = watcherCount();
		const hangup = new AbortController();
		const pending = waitFor(
			{ runs: [run.id], sandboxes: [run.instance_id] },
			{ timeoutMs: 60_000, signal: hangup.signal }
		);
		expect(watcherCount()).toBe(before + 2);
		hangup.abort();
		expect(await pending).toMatchObject({ settled: false, aborted: true });
		expect(watcherCount()).toBe(before);
		await stopRun(run.id);
	});

	test('mode "all" waits for every run while "any" returns on the first', async () => {
		const a = startRun(seed(), 'a');
		const b = startRun(seed(), 'b');
		const all = waitFor({ runs: [a.id, b.id] }, { timeoutMs: 60_000 });
		const any = waitFor({ runs: [a.id, b.id] }, { timeoutMs: 60_000, mode: 'any' });
		await stopRun(a.id);
		const first = await any;
		expect(first.settled).toBe(true);
		expect(first.runs.map((r) => r.row?.status)).toEqual(['cancelled', 'queued']);
		await stopRun(b.id);
		expect((await all).runs.map((r) => r.row?.status)).toEqual(['cancelled', 'cancelled']);
	});

	test('several waiters on one run all hear about it', async () => {
		const run = startRun(seed(), 'go');
		const waiters = [1, 2, 3].map(() => waitFor({ runs: [run.id] }, { timeoutMs: 60_000 }));
		await stopRun(run.id);
		for (const outcome of await Promise.all(waiters)) expect(outcome.settled).toBe(true);
	});

	test('a sandbox settles when its boot flips it off creating', async () => {
		const inst = seed();
		const pending = waitFor({ sandboxes: [inst.id] }, { timeoutMs: 60_000 });
		updateInstance(inst.id, { status: 'error', error: 'boom' });
		triggerReconcile();
		const outcome = await pending;
		expect(outcome.settled).toBe(true);
		expect(outcome.sandboxes[0]!.row).toMatchObject({ status: 'error', error: 'boom' });
	});

	test('a sandbox deleted mid-wait settles as missing instead of hanging', async () => {
		const inst = seed();
		const pending = waitFor({ sandboxes: [inst.id] }, { timeoutMs: 60_000 });
		deleteInstanceRow(inst.id);
		triggerReconcile();
		expect((await pending).sandboxes[0]!.row).toBeNull();
	});

	test('refuses an unknown id rather than treating it as settled', () => {
		expect(() => waitFor({ runs: ['nope'] }, { timeoutMs: 10 })).toThrow('No run with id nope');
		expect(() => waitFor({}, { timeoutMs: 10 })).toThrow('nothing to wait for');
	});

	test('the terminal row is what comes back, so a waiter never needs a follow-up get_run', async () => {
		const run = startRun(seed(), 'go');
		const pending = waitFor({ runs: [run.id] }, { timeoutMs: 60_000 });
		await stopRun(run.id, 'because');
		const outcome = await pending;
		expect(outcome.runs[0]!.row).toEqual(getRun(run.id));
		expect(outcome.runs[0]!.row?.error).toBe('because');
	});
});
