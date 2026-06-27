import { rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { INSTANCES_DIR, PORT_BASE, PORT_MAX } from './config.server.ts';
import {
  allInstances,
  deleteInstanceRow,
  getInstance,
  insertInstance,
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
import { copyWorkspace, devcontainerUp, writeOverrideConfig } from './devcontainer.server.ts';
import { injectClaudeCredentials, readClaudeCredentials } from './claude.server.ts';
import { injectGhCredentials, readGhCredentials } from './gh.server.ts';
import { readGitBranch } from './git.server.ts';
import type { Instance } from '../types.ts';

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

// --- Live instance-list stream (SSE) ---------------------------------------
// One hub broadcasts the reconciled instance list to all subscribers, ticking
// periodically to pick up external Docker state changes and immediately on any
// mutation. Subscribers receive the full list as their first message.

interface InstancesHub {
  listeners: Set<(list: Instance[]) => void>;
  timer: ReturnType<typeof setInterval> | null;
  lastJson: string;
}

const globalForHub = globalThis as unknown as { __dcmHub?: InstancesHub };
const hub: InstancesHub = (globalForHub.__dcmHub ??= { listeners: new Set(), timer: null, lastJson: '' });

async function reconcileAndBroadcast(force = false): Promise<void> {
  const list = await listInstances();
  const json = JSON.stringify(list);
  if (!force && json === hub.lastJson) return;
  hub.lastJson = json;
  // Guard each send and drop subscribers whose stream has already closed.
  for (const cb of [...hub.listeners]) {
    try {
      cb(list);
    } catch {
      hub.listeners.delete(cb);
    }
  }
}

/** Notify all subscribers that the instance list changed (immediate push). */
export function triggerReconcile(): void {
  void reconcileAndBroadcast(true);
}

/** Subscribe to the live instance list; the callback fires immediately with current state. */
export function subscribeInstances(cb: (list: Instance[]) => void): () => void {
  hub.listeners.add(cb);
  if (!hub.timer) hub.timer = setInterval(() => void reconcileAndBroadcast(), 3000);
  void listInstances().then(cb);
  return () => {
    hub.listeners.delete(cb);
    if (hub.listeners.size === 0 && hub.timer) {
      clearInterval(hub.timer);
      hub.timer = null;
    }
  };
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

/** Drive the long-running boot: copy → inject config → devcontainer up. */
async function boot(row: InstanceRow): Promise<void> {
  try {
    appendLog(row.id, `Copying ${row.source_path} → ${row.workspace_path}\n`);
    await copyWorkspace(row.source_path, row.workspace_path);

    appendLog(row.id, `Injecting code-server (host port ${row.host_port})\n`);
    await writeOverrideConfig(row.workspace_path, row.host_port);

    appendLog(row.id, `Starting devcontainer…\n`);
    const result = await devcontainerUp(row.workspace_path, (chunk) => appendLog(row.id, chunk));

    if (result.outcome !== 'success' || !result.containerId) {
      throw new Error(result.message || result.description || `devcontainer up failed (${result.outcome})`);
    }

    updateInstance(row.id, {
      container_id: result.containerId,
      remote_workspace_folder: result.remoteWorkspaceFolder ?? null,
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

    appendLog(row.id, `\n✓ Instance running — open it via the proxy at /p/${row.id}/\n`);
  } catch (err) {
    const message = (err as Error).message;
    updateInstance(row.id, { status: 'error', error: message });
    appendLog(row.id, `\n✗ Error: ${message}\n`);
  }
  triggerReconcile();
}

/** Create an instance row and kick off its boot in the background. */
export async function createInstance(sourcePath: string, name?: string): Promise<InstanceRow> {
  await assertDir(sourcePath);
  const id = crypto.randomUUID();
  const folderName = basename(sourcePath) || 'workspace';
  const row: InstanceRow = {
    id,
    name: name?.trim() || folderName,
    source_path: sourcePath,
    workspace_path: join(INSTANCES_DIR, id, folderName),
    host_port: allocatePort(),
    container_id: null,
    remote_workspace_folder: null,
    status: 'creating',
    error: null,
    created_at: Date.now(),
  };
  insertInstance(row);
  recordFolder(sourcePath, row.name);
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
  return rows.map((row) => ({ ...row, git_branch: branches.get(row.id) ?? null }));
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
  triggerReconcile();
  return getInstance(id)!;
}

export async function deleteInstance(id: string): Promise<void> {
  const row = getInstance(id);
  if (!row) return;
  if (row.container_id) await removeContainer(row.container_id);
  await rm(join(INSTANCES_DIR, id), { recursive: true, force: true });
  deleteInstanceRow(id);
  registry.delete(id);
  triggerReconcile();
}

export async function deleteAllInstances(): Promise<void> {
  for (const row of allInstances()) {
    await deleteInstance(row.id);
  }
}
