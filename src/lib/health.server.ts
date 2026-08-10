import { type InstanceRow } from './db.server.ts';
import { isRunning, publishedContainerPorts } from './docker.server.ts';
import { broadcastHealth } from './instances.server.ts';
import { resolveInjections } from './injections.server.ts';
import type { InstanceHealth } from '../types.ts';

const REFRESH_MS = 5000;
const FAST_REFRESH_MS = 1000;
const FAST_WINDOW_MS = 120_000;

interface Monitor {
	snapshot: InstanceHealth | null;
	timer: ReturnType<typeof setTimeout>;
	startedAt: number;
	everAccessible: boolean;
}

// Pin to globalThis so dev-mode hot reload doesn't orphan the interval timers.
const globalForHealth = globalThis as unknown as { __codebayHealth?: Map<string, Monitor> };
const monitors: Map<string, Monitor> = (globalForHealth.__codebayHealth ??= new Map());

async function codeServerAccessible(port: number): Promise<boolean> {
	try {
		// Any HTTP response at all (200/302/401/…) means the server is listening.
		await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

async function check(row: InstanceRow): Promise<InstanceHealth> {
	const down: InstanceHealth = {
		containerRunning: false,
		codeServerAccessible: false,
		injections: [],
		openPorts: [],
		checkedAt: Date.now()
	};
	if (!row.container_id || !(await isRunning(row.container_id))) return down;

	// Probes as the recorded remote user, so `$HOME` resolves to the one the injection wrote to.
	const target = { containerId: row.container_id, remoteUser: row.remote_user, instance: row };
	const [accessible, openPorts, injectionResults] = await Promise.all([
		codeServerAccessible(row.host_port),
		publishedContainerPorts(row.container_id),
		Promise.all(
			resolveInjections(row.mode)
				.filter((i) => i.check)
				.map(async (i) => ({
					id: i.id,
					label: i.label,
					ok: await i.check!(target).catch(() => false)
				}))
		)
	]);
	return {
		containerRunning: true,
		codeServerAccessible: accessible,
		injections: injectionResults,
		openPorts,
		checkedAt: Date.now()
	};
}

/** Probes at 1s until code-server first answers, so the IDE iframe can mount without waiting out
 * the 5s cadence; the window cap keeps a permanently-dead code-server off the fast path. */
export function nextProbeDelay(
	health: InstanceHealth,
	everAccessible: boolean,
	elapsedMs: number
): number {
	const waitingForFirstResponse =
		health.containerRunning && !health.codeServerAccessible && !everAccessible;
	return waitingForFirstResponse && elapsedMs < FAST_WINDOW_MS ? FAST_REFRESH_MS : REFRESH_MS;
}

async function tick(row: InstanceRow, mon: Monitor): Promise<void> {
	const snapshot = await check(row);
	broadcastHealth(row.id, snapshot);
	// Replaced or stopped while the probe was in flight — rescheduling would leak a second chain.
	if (monitors.get(row.id) !== mon) return;
	if (!snapshot.containerRunning) {
		stopHealthMonitor(row.id);
		return;
	}
	mon.snapshot = snapshot;
	mon.everAccessible ||= snapshot.codeServerAccessible;
	const delay = nextProbeDelay(snapshot, mon.everAccessible, Date.now() - mon.startedAt);
	mon.timer = setTimeout(() => void tick(row, mon), delay);
}

function startHealthMonitor(row: InstanceRow): Monitor {
	const existing = monitors.get(row.id);
	if (existing) return existing;
	const mon: Monitor = {
		snapshot: null,
		// Placeholder until the seed tick completes; it self-reschedules from then on.
		timer: setTimeout(() => undefined, 0),
		startedAt: Date.now(),
		everAccessible: false
	};
	monitors.set(row.id, mon);
	void tick(row, mon); // seed the first snapshot rather than making the UI wait a full interval
	return mon;
}

export function stopHealthMonitor(id: string): void {
	const mon = monitors.get(id);
	if (!mon) return;
	clearTimeout(mon.timer);
	monitors.delete(id);
}

/** Driven from the reconcile loop, so monitors track the container lifecycle automatically. */
export function syncHealthMonitors(rows: InstanceRow[]): void {
	const running = new Set(
		rows.filter((r) => r.status === 'running' && r.container_id).map((r) => r.id)
	);
	for (const row of rows) {
		if (running.has(row.id) && !monitors.has(row.id)) startHealthMonitor(row);
	}
	for (const id of [...monitors.keys()]) {
		if (!running.has(id)) stopHealthMonitor(id);
	}
}

export function currentHealthSnapshots(): { id: string; health: InstanceHealth }[] {
	const out: { id: string; health: InstanceHealth }[] = [];
	for (const [id, mon] of monitors) {
		if (mon.snapshot) out.push({ id, health: mon.snapshot });
	}
	return out;
}
