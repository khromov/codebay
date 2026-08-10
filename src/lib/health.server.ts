import { type InstanceRow } from './db.server.ts';
import { isRunning, publishedContainerPorts } from './docker.server.ts';
import { broadcastHealth, relaunchSurface } from './instances.server.ts';
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

/** Named for what it measures — the served surface is ttyd in terminal mode, code-server in IDE. */
export async function surfaceAccessible(port: number): Promise<boolean> {
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
		surfaceAccessible(row.host_port),
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
	// Seed a snapshot rather than making the UI wait a full interval (the tick self-reschedules
	// the fast/slow probe chain from here), then use the seed to decide whether to relaunch.
	void tick(row, mon).then(async () => {
		if (monitors.get(row.id) !== mon) return;
		const seeded = mon.snapshot;
		if (!seeded?.containerRunning || seeded.codeServerAccessible) return;
		// A live container with a dead port means postStartCommand never re-ran — it only fires
		// under `devcontainer up`. Covers starts codebay didn't perform (a daemon restart, a bare
		// `docker start`); once per monitor, so a genuinely wedged container isn't exec'd in a loop.
		await relaunchSurface(row).catch(() => undefined);
		if (monitors.get(row.id) !== mon) return;
		// Drop the seed tick's already-scheduled probe and re-probe now, so a single chain survives.
		clearTimeout(mon.timer);
		void tick(row, mon);
	});
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
