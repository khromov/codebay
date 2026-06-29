import { type InstanceRow } from './db.server.ts';
import { isRunning, publishedContainerPorts } from './docker.server.ts';
import { broadcastHealth } from './instances.server.ts';
import type { InstanceHealth } from '../types.ts';

/**
 * Per-container health monitoring. Each running container gets a background job
 * that re-runs every check on a fixed interval and keeps the latest snapshot in
 * memory — results are live and never persisted. A job starts when reconcile
 * sees the container running and stops as soon as the container is gone.
 */

const REFRESH_MS = 5000;

interface Monitor {
  snapshot: InstanceHealth | null;
  timer: ReturnType<typeof setInterval>;
}

// Pin to globalThis so dev-mode hot reload doesn't orphan the interval timers.
const globalForHealth = globalThis as unknown as { __dcmHealth?: Map<string, Monitor> };
const monitors: Map<string, Monitor> = (globalForHealth.__dcmHealth ??= new Map());

/** Probe whether code-server is answering on its published host port. */
async function codeServerAccessible(port: number): Promise<boolean> {
  try {
    // Any HTTP response (200/302/401/…) means the server is listening.
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify, live, that our Claude files are present inside the container. One
 * `docker exec` checks both: the attention hooks (settings.json mentioning this
 * instance id) and the injected credentials. Runs as the recorded remote user so
 * it resolves the same home the injection wrote to; when unknown, falls back to
 * the container's default exec user (typically that same remote user).
 */
async function claudeFilesPresent(
  containerId: string,
  remoteUser: string | null,
  id: string,
): Promise<{ hooks: boolean; creds: boolean }> {
  const script =
    'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; hooks=0; creds=0; ' +
    `[ -s "$d/settings.json" ] && grep -q '${id}' "$d/settings.json" && hooks=1; ` +
    '[ -s "$d/.credentials.json" ] && creds=1; echo "$hooks $creds"';
  const cmd = ['docker', 'exec'];
  if (remoteUser?.trim()) cmd.push('-u', remoteUser.trim());
  cmd.push(containerId, 'bash', '-lc', script);
  try {
    const proc = Bun.spawn(cmd, {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return { hooks: false, creds: false };
    const [h, c] = out.trim().split(/\s+/);
    return { hooks: h === '1', creds: c === '1' };
  } catch {
    return { hooks: false, creds: false };
  }
}

/** Run every health check for one instance and return a fresh snapshot. */
async function check(row: InstanceRow): Promise<InstanceHealth> {
  const down: InstanceHealth = {
    containerRunning: false,
    codeServerAccessible: false,
    hooksPresent: false,
    credsPresent: false,
    openPorts: [],
    checkedAt: Date.now(),
  };
  if (!row.container_id || !(await isRunning(row.container_id))) return down;

  const [accessible, files, openPorts] = await Promise.all([
    codeServerAccessible(row.host_port),
    claudeFilesPresent(row.container_id, row.remote_user, row.id),
    publishedContainerPorts(row.container_id),
  ]);
  return {
    containerRunning: true,
    codeServerAccessible: accessible,
    hooksPresent: files.hooks,
    credsPresent: files.creds,
    openPorts,
    checkedAt: Date.now(),
  };
}

/** One monitor cycle: refresh the snapshot, push it live, and retire the job once down. */
async function tick(row: InstanceRow): Promise<void> {
  const snapshot = await check(row);
  const mon = monitors.get(row.id);
  if (mon) mon.snapshot = snapshot;
  broadcastHealth(row.id, snapshot);
  if (!snapshot.containerRunning) stopHealthMonitor(row.id);
}

/** Start a background monitor for a running instance (no-op if one already exists). */
function startHealthMonitor(row: InstanceRow): Monitor {
  const existing = monitors.get(row.id);
  if (existing) return existing;
  const mon: Monitor = { snapshot: null, timer: setInterval(() => void tick(row), REFRESH_MS) };
  monitors.set(row.id, mon);
  void tick(row); // seed the first snapshot immediately rather than waiting a full interval
  return mon;
}

/** Stop and forget an instance's monitor. */
export function stopHealthMonitor(id: string): void {
  const mon = monitors.get(id);
  if (!mon) return;
  clearInterval(mon.timer);
  monitors.delete(id);
}

/**
 * Reconcile monitors against the current instance list: every running container
 * gets a job, everything else (stopped, errored, deleted) has its job retired.
 * Called from the reconcile loop so jobs track container lifecycle automatically.
 */
export function syncHealthMonitors(rows: InstanceRow[]): void {
  const running = new Set(
    rows.filter((r) => r.status === 'running' && r.container_id).map((r) => r.id),
  );
  for (const row of rows) {
    if (running.has(row.id) && !monitors.has(row.id)) startHealthMonitor(row);
  }
  for (const id of [...monitors.keys()]) {
    if (!running.has(id)) stopHealthMonitor(id);
  }
}

/** Every monitor's latest snapshot, for seeding a freshly-connected stream client. */
export function currentHealthSnapshots(): { id: string; health: InstanceHealth }[] {
  const out: { id: string; health: InstanceHealth }[] = [];
  for (const [id, mon] of monitors) {
    if (mon.snapshot) out.push({ id, health: mon.snapshot });
  }
  return out;
}
