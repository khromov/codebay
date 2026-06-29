import { rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CODE_SERVER_PORT, DATA_DIR, INSTANCES_DIR, PORT_BASE, PORT_MAX } from './config.server.ts';
import {
  allForwards,
  allInstances,
  closeDb,
  deleteForward,
  deleteForwards,
  deleteInstanceRow,
  getInstance,
  insertForward,
  insertInstance,
  listForwards,
  recordFolder,
  updateInstance,
  usedPorts,
  type InstanceRow,
  type InstanceStatus,
} from './db.server.ts';
import {
  isRunning,
  markGitSafeDirectory,
  removeContainer,
  startContainer,
  stopContainer,
} from './docker.server.ts';
import {
  copyWorkspace,
  devcontainerUp,
  readDeclaredContainerPorts,
  writeOverrideConfig,
} from './devcontainer.server.ts';
import { injectClaudeCredentials, readClaudeCredentials } from './claude.server.ts';
import {
  attentionHookSettings,
  clearAttention,
  getAttention,
  injectClaudeHooks,
} from './bridge.server.ts';
import { injectGhCredentials, readGhCredentials } from './gh.server.ts';
import { readGitBranch } from './git.server.ts';
import {
  currentHealthSnapshots,
  stopHealthMonitor,
  syncHealthMonitors,
} from './health.server.ts';
import type { ServerWebSocket } from 'bun';
import type { Instance, InstanceHealth } from '../types.ts';

/** Live, in-memory boot state for an instance (logs + SSE subscribers). */
interface LiveState {
  logs: string[];
  subscribers: Set<(chunk: string) => void>;
}

const globalForReg = globalThis as unknown as { __dcmRegistry?: Map<string, LiveState> };
const registry: Map<string, LiveState> = (globalForReg.__dcmRegistry ??= new Map());

function live(id: string): LiveState {
  let state = registry.get(id);
  if (!state) {
    state = { logs: [], subscribers: new Set() };
    registry.set(id, state);
  }
  return state;
}

function appendLog(id: string, chunk: string): void {
  const state = live(id);
  state.logs.push(chunk);
  if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
  // Guard each send: a client that disconnected leaves a closed stream that throws.
  for (const sub of [...state.subscribers]) {
    try {
      sub(chunk);
    } catch {
      state.subscribers.delete(sub);
    }
  }
}

/** Replay buffered logs and stream future ones; returns an unsubscribe fn. */
export function subscribeLogs(id: string, onChunk: (chunk: string) => void): () => void {
  const state = live(id);
  for (const line of state.logs) onChunk(line);
  state.subscribers.add(onChunk);
  return () => state.subscribers.delete(onChunk);
}

// --- Central live stream (WebSocket) ---------------------------------------
// One hub broadcasts typed events to every connected `/api/stream` socket: the
// full reconciled instance list (`instances`) and continuous per-instance
// `health`. It reconciles on a periodic tick to pick up external Docker state
// changes and immediately on any mutation. A fresh socket is seeded with the
// current list plus the latest health snapshots.

/** A message pushed to clients on the central stream; clients filter by `type`. */
export type StreamEvent =
  | { type: 'instances'; data: Instance[] }
  | { type: 'health'; data: { id: string; health: InstanceHealth } };

interface StreamHub {
  sockets: Set<ServerWebSocket<unknown>>;
  timer: ReturnType<typeof setInterval> | null;
  lastListJson: string;
}

const globalForHub = globalThis as unknown as { __dcmHub?: StreamHub };
const hub: StreamHub = (globalForHub.__dcmHub ??= { sockets: new Set(), timer: null, lastListJson: '' });

/** Serialize an event once and fan it out, dropping sockets that have closed. */
function broadcast(event: StreamEvent): void {
  const frame = JSON.stringify(event);
  for (const ws of [...hub.sockets]) {
    try {
      ws.send(frame);
    } catch {
      hub.sockets.delete(ws);
    }
  }
}

function sendTo(ws: ServerWebSocket<unknown>, event: StreamEvent): void {
  try {
    ws.send(JSON.stringify(event));
  } catch {
    hub.sockets.delete(ws);
  }
}

/** Push a fresh health snapshot for one instance to all stream clients. */
export function broadcastHealth(id: string, health: InstanceHealth): void {
  broadcast({ type: 'health', data: { id, health } });
}

async function reconcileAndBroadcast(force = false): Promise<void> {
  const list = await listInstances();
  const json = JSON.stringify(list);
  if (!force && json === hub.lastListJson) return;
  hub.lastListJson = json;
  broadcast({ type: 'instances', data: list });
}

/** Notify all clients that the instance list changed (immediate push). */
export function triggerReconcile(): void {
  void reconcileAndBroadcast(true);
}

/** A new `/api/stream` socket connected: register it, seed it, and ensure the tick runs. */
export function streamOpen(ws: ServerWebSocket<unknown>): void {
  hub.sockets.add(ws);
  if (!hub.timer) hub.timer = setInterval(() => void reconcileAndBroadcast(), 3000);
  // Seed the freshly-connected client: full list now, plus whatever health we
  // already have. Newly-running instances fill in on the next monitor tick.
  void listInstances().then((list) => sendTo(ws, { type: 'instances', data: list }));
  for (const snap of currentHealthSnapshots()) sendTo(ws, { type: 'health', data: snap });
}

/** A `/api/stream` socket closed: unregister it and stop the tick when idle. */
export function streamClose(ws: ServerWebSocket<unknown>): void {
  hub.sockets.delete(ws);
  if (hub.sockets.size === 0 && hub.timer) {
    clearInterval(hub.timer);
    hub.timer = null;
  }
}

function allocatePort(): number {
  const taken = new Set(usedPorts());
  for (let port = PORT_BASE; port <= PORT_MAX; port++) {
    if (!taken.has(port)) return port;
  }
  throw new Error('No free host ports available.');
}

/** Validate that a path exists and is a directory. */
async function assertDir(path: string): Promise<void> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`Folder does not exist: ${path}`);
  }
  if (!info.isDirectory()) throw new Error(`Not a folder: ${path}`);
}

/** Drive the first boot: copy workspace → seed declared ports → provision the container. */
async function boot(row: InstanceRow): Promise<void> {
  try {
    appendLog(row.id, `Copying ${row.source_path} → ${row.workspace_path}\n`);
    await copyWorkspace(row.source_path, row.workspace_path);
    await seedDeclaredPorts(row);
  } catch (err) {
    const message = (err as Error).message;
    updateInstance(row.id, { status: 'error', error: message });
    appendLog(row.id, `\n✗ Error: ${message}\n`);
    triggerReconcile();
    return;
  }
  await provision(row);
}

/**
 * Allocate a unique host port for every container port the project declares
 * (`forwardPorts`/`appPort`) and persist it as a forward. Runs on first boot after the copy,
 * before config injection, so it reads the pristine config. Idempotent — skips ports already
 * forwarded, so it's a no-op on rebuild.
 */
async function seedDeclaredPorts(row: InstanceRow): Promise<void> {
  const existing = new Set(listForwards(row.id).map((f) => f.container_port));
  for (const containerPort of await readDeclaredContainerPorts(row.workspace_path)) {
    if (existing.has(containerPort)) continue;
    const hostPort = allocatePort();
    insertForward({
      instance_id: row.id,
      container_port: containerPort,
      host_port: hostPort,
      created_at: Date.now(),
    });
    existing.add(containerPort);
    appendLog(row.id, `Forwarding declared port ${containerPort} → localhost:${hostPort}\n`);
  }
}

/**
 * (Re-)inject config and run `devcontainer up`, then provision auth/hooks. Shared by the first
 * boot and by `rebuildInstance` — it never re-copies the workspace, so in-container edits survive
 * a rebuild. `--remove-existing-container` recreates the container with the current published ports.
 */
async function provision(row: InstanceRow): Promise<void> {
  try {
    const forwards = listForwards(row.id).map((f) => ({
      container_port: f.container_port,
      host_port: f.host_port,
    }));
    appendLog(row.id, `Injecting code-server (host port ${row.host_port})\n`);
    await writeOverrideConfig(row.workspace_path, row.host_port, forwards);

    appendLog(row.id, `Starting devcontainer…\n`);
    const result = await devcontainerUp(row.workspace_path, (chunk) => appendLog(row.id, chunk));

    if (result.outcome !== 'success' || !result.containerId) {
      throw new Error(result.message || result.description || `devcontainer up failed (${result.outcome})`);
    }

    updateInstance(row.id, {
      container_id: result.containerId,
      remote_workspace_folder: result.remoteWorkspaceFolder ?? null,
      remote_user: result.remoteUser ?? null,
      status: 'running',
      error: null,
    });

    // The copied .git is owned by the host UID, so let the container user use it.
    const safe = await markGitSafeDirectory(result.containerId, result.remoteUser);
    if (!safe.ok) appendLog(row.id, `⚠ git safe.directory setup failed: ${safe.error}\n`);

    // Containers are throwaway, so copy the host's Claude Code auth into each one.
    const creds = await readClaudeCredentials();
    if (creds) {
      appendLog(row.id, 'Injecting Claude Code credentials…\n');
      const injected = await injectClaudeCredentials(result.containerId, result.remoteUser, creds);
      appendLog(
        row.id,
        injected.ok
          ? '✓ Claude Code authorized in container\n'
          : `⚠ Claude auth injection failed: ${injected.error}\n`,
      );
    } else {
      appendLog(row.id, '⚠ No Claude Code credentials found on host; skipped auth injection\n');
    }

    // Likewise copy the host's GitHub CLI auth so `gh` and git-over-HTTPS work.
    const gh = await readGhCredentials();
    if (gh) {
      appendLog(row.id, 'Injecting GitHub CLI credentials…\n');
      const injected = await injectGhCredentials(result.containerId, result.remoteUser, gh);
      appendLog(
        row.id,
        injected.ok
          ? '✓ GitHub CLI authorized in container\n'
          : `⚠ gh auth injection failed: ${injected.error}\n`,
      );
    } else {
      appendLog(row.id, '⚠ No GitHub CLI credentials found on host; skipped gh injection\n');
    }

    // Inject the attention hook so the in-container Claude pings the manager when
    // it finishes a task or needs input, pulsing this instance's IDE tab.
    appendLog(row.id, 'Injecting Claude attention hooks…\n');
    const hooks = await injectClaudeHooks(
      result.containerId,
      result.remoteUser,
      attentionHookSettings(row.id, row.bridge_token),
    );
    appendLog(
      row.id,
      hooks.ok
        ? '✓ Claude attention hooks installed\n'
        : `⚠ Claude hook injection failed: ${hooks.error}\n`,
    );

    appendLog(row.id, `\n✓ Instance running — open it via the proxy at /p/${row.id}/\n`);
  } catch (err) {
    const message = (err as Error).message;
    updateInstance(row.id, { status: 'error', error: message });
    appendLog(row.id, `\n✗ Error: ${message}\n`);
  }
  triggerReconcile();
}

/**
 * Make `desired` unique against existing instance names by appending a
 * `#2`, `#3`, … suffix. The first instance keeps the bare name.
 */
function uniqueName(desired: string): string {
  const taken = new Set(allInstances().map((row) => row.name));
  if (!taken.has(desired)) return desired;
  for (let n = 2; ; n++) {
    const candidate = `${desired} #${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Create an instance row and kick off its boot in the background. */
export async function createInstance(sourcePath: string, name?: string): Promise<InstanceRow> {
  await assertDir(sourcePath);
  const id = crypto.randomUUID();
  const folderName = basename(sourcePath) || 'workspace';
  const row: InstanceRow = {
    id,
    name: uniqueName(name?.trim() || folderName),
    source_path: sourcePath,
    workspace_path: join(INSTANCES_DIR, id, folderName),
    host_port: allocatePort(),
    container_id: null,
    remote_workspace_folder: null,
    status: 'creating',
    error: null,
    created_at: Date.now(),
    bridge_token: crypto.randomUUID().replace(/-/g, ''),
    remote_user: null,
  };
  insertInstance(row);
  // Strip the de-dup `#2` suffix so the recent-folders list keeps the base name.
  recordFolder(sourcePath, row.name.replace(/ #\d+$/, ''));
  triggerReconcile();
  void boot(row);
  return row;
}

/** List instances, reconciling persisted status against the live Docker state. */
export async function listInstances(): Promise<Instance[]> {
  const rows = allInstances();
  // Branch is polled per reconcile (not persisted) — it changes inside the container.
  const branches = new Map<string, string | null>();
  await Promise.all(
    rows.map(async (row) => {
      if (!row.container_id || row.status === 'creating' || row.status === 'error') return;
      const running = await isRunning(row.container_id);
      const next: InstanceStatus = running ? 'running' : 'stopped';
      if (next !== row.status) {
        updateInstance(row.id, { status: next });
        row.status = next;
      }
      // The workspace is bind-mounted, so the host copy's .git/HEAD tracks the
      // branch checked out inside the container.
      branches.set(row.id, await readGitBranch(row.workspace_path));
    }),
  );
  // Keep a background health monitor running for each live container (and retire
  // monitors for the rest) — reconcile is where we know the current running set.
  syncHealthMonitors(rows);
  // Group forwarded ports per instance in a single query (mirrors the branches map).
  const forwards = new Map<string, { container_port: number; host_port: number }[]>();
  for (const f of allForwards()) {
    const list = forwards.get(f.instance_id) ?? [];
    list.push({ container_port: f.container_port, host_port: f.host_port });
    forwards.set(f.instance_id, list);
  }
  // Strip bridge_token — it's a container-only secret and must not reach the client.
  return rows.map(({ bridge_token: _token, ...row }) => ({
    ...row,
    git_branch: branches.get(row.id) ?? null,
    attention: getAttention(row.id),
    forwarded_ports: forwards.get(row.id) ?? [],
  }));
}

export function renameInstance(id: string, name: string): InstanceRow {
  const row = getInstance(id);
  if (!row) throw new Error('Instance not found');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name cannot be empty');
  updateInstance(id, { name: trimmed });
  triggerReconcile();
  return getInstance(id)!;
}

/** Allocate a host port for a new container port and persist it. Apply via `rebuildInstance`. */
export function addForwardedPort(id: string, containerPort: number): InstanceRow {
  const row = getInstance(id);
  if (!row) throw new Error('Instance not found');
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
    throw new Error('Port must be an integer between 1 and 65535');
  }
  if (containerPort === CODE_SERVER_PORT) {
    throw new Error(`Port ${CODE_SERVER_PORT} is reserved for code-server`);
  }
  if (listForwards(id).some((f) => f.container_port === containerPort)) {
    throw new Error(`Port ${containerPort} is already forwarded`);
  }
  insertForward({
    instance_id: id,
    container_port: containerPort,
    host_port: allocatePort(),
    created_at: Date.now(),
  });
  triggerReconcile();
  return getInstance(id)!;
}

/** Drop a forwarded port. Frees its host port; apply via `rebuildInstance`. */
export function removeForwardedPort(id: string, containerPort: number): InstanceRow {
  const row = getInstance(id);
  if (!row) throw new Error('Instance not found');
  deleteForward(id, containerPort);
  triggerReconcile();
  return getInstance(id)!;
}

/**
 * Re-run `devcontainer up` to apply the current forwarded-port set, recreating the container
 * (in-container edits survive — the workspace isn't re-copied). No-op if already (re)building.
 */
export function rebuildInstance(id: string): InstanceRow {
  const row = getInstance(id);
  if (!row) throw new Error('Instance not found');
  if (row.status === 'creating') return row; // a build is already in flight
  updateInstance(id, { status: 'creating', error: null });
  triggerReconcile();
  const fresh = getInstance(id)!;
  appendLog(id, `\n— Rebuilding to apply port changes —\n`);
  void provision(fresh);
  return fresh;
}

export async function startInstance(id: string): Promise<InstanceRow> {
  const row = getInstance(id);
  if (!row) throw new Error('Instance not found');
  if (!row.container_id) throw new Error('Instance has no container yet');
  const ok = await startContainer(row.container_id);
  updateInstance(id, { status: ok ? 'running' : 'error', error: ok ? null : 'Failed to start container' });
  triggerReconcile();
  return getInstance(id)!;
}

export async function stopInstance(id: string): Promise<InstanceRow> {
  const row = getInstance(id);
  if (!row) throw new Error('Instance not found');
  if (row.container_id) await stopContainer(row.container_id);
  updateInstance(id, { status: 'stopped' });
  clearAttention(id);
  triggerReconcile();
  return getInstance(id)!;
}

export async function deleteInstance(id: string): Promise<void> {
  const row = getInstance(id);
  if (!row) return;
  if (row.container_id) await removeContainer(row.container_id);
  await rm(join(INSTANCES_DIR, id), { recursive: true, force: true });
  deleteForwards(id);
  deleteInstanceRow(id);
  registry.delete(id);
  stopHealthMonitor(id);
  clearAttention(id);
  triggerReconcile();
}

export async function deleteAllInstances(): Promise<void> {
  for (const row of allInstances()) {
    await deleteInstance(row.id);
  }
}

/**
 * Full reset: tear down every instance (containers + workspace copies + DB rows),
 * close and delete the SQLite database, then exit the process. The process exit is
 * deferred briefly so the HTTP response can flush before the server dies.
 */
export async function deleteDatabaseAndShutdown(): Promise<void> {
  await deleteAllInstances();
  closeDb();
  await rm(DATA_DIR, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 150);
}
