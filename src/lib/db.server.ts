import { Database } from 'bun:sqlite';
import { migrate, getMigrations } from '@zihaolam/bun-sqlite-migrations';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, DB_PATH } from './config.server.ts';

// db.server.ts lives in src/lib, so ../../migrations resolves to the repo root.
const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

/** Possible lifecycle states for an instance row. */
export type InstanceStatus = 'creating' | 'running' | 'stopped' | 'error';

/** One previously-used source folder, kept for quick re-creation. */
export interface FolderHistoryRow {
  source_path: string;
  name: string;
  last_used_at: number;
}

/** Durable record of one devcontainer instance. */
export interface InstanceRow {
  id: string;
  name: string;
  source_path: string;
  workspace_path: string;
  host_port: number;
  container_id: string | null;
  remote_workspace_folder: string | null;
  status: InstanceStatus;
  error: string | null;
  created_at: number;
  /** Per-instance secret the in-container Claude hook uses to authenticate to the bridge. */
  bridge_token: string;
  /** Container user the workspace runs as; needed to exec health checks in its home dir. */
  remote_user: string | null;
  /**
   * Which image this instance was created with: the literal `'local'` when the source
   * folder shipped its own devcontainer.json, or the default image reference that was
   * injected when it had none. Null on rows created before this was recorded.
   */
  image_source: string | null;
}

/** One published container→host port mapping for an instance (besides code-server). */
export interface PortForwardRow {
  instance_id: string;
  container_port: number;
  host_port: number;
  created_at: number;
}

// Pin the connection to globalThis so dev-mode hot reload doesn't reopen it.
const globalForDb = globalThis as unknown as { __dcmDb?: Database };

function open(): Database {
  mkdirSync(DATA_DIR, { recursive: true });
  const database = new Database(DB_PATH, { create: true });
  database.run('PRAGMA journal_mode = WAL;');
  migrate(database, getMigrations(MIGRATIONS_DIR));
  return database;
}

export const db: Database = (globalForDb.__dcmDb ??= open());

/** Close the pinned SQLite connection (flushing WAL) and drop the global handle. */
export function closeDb(): void {
  globalForDb.__dcmDb?.close();
  globalForDb.__dcmDb = undefined;
}

export function insertInstance(row: InstanceRow): void {
  db.query(
    `INSERT INTO instances
       (id, name, source_path, workspace_path, host_port, container_id, remote_workspace_folder, status, error, created_at, bridge_token, remote_user, image_source)
     VALUES ($id, $name, $source_path, $workspace_path, $host_port, $container_id, $remote_workspace_folder, $status, $error, $created_at, $bridge_token, $remote_user, $image_source)`,
  ).run({
    $id: row.id,
    $name: row.name,
    $source_path: row.source_path,
    $workspace_path: row.workspace_path,
    $host_port: row.host_port,
    $container_id: row.container_id,
    $remote_workspace_folder: row.remote_workspace_folder,
    $status: row.status,
    $error: row.error,
    $created_at: row.created_at,
    $bridge_token: row.bridge_token,
    $remote_user: row.remote_user,
    $image_source: row.image_source,
  });
}

export function getInstance(id: string): InstanceRow | null {
  return db.query('SELECT * FROM instances WHERE id = $id').get({ $id: id }) as InstanceRow | null;
}

export function allInstances(): InstanceRow[] {
  return db.query('SELECT * FROM instances ORDER BY created_at DESC').all() as InstanceRow[];
}

export function usedPorts(): number[] {
  // Union code-server's host ports with every forwarded host port so allocation
  // never hands out one that's already published by either table.
  const rows = db
    .query('SELECT host_port FROM instances UNION SELECT host_port FROM port_forwards')
    .all() as { host_port: number }[];
  return rows.map((r) => r.host_port);
}

export function listForwards(instanceId: string): PortForwardRow[] {
  return db
    .query('SELECT * FROM port_forwards WHERE instance_id = $id ORDER BY container_port')
    .all({ $id: instanceId }) as PortForwardRow[];
}

export function allForwards(): PortForwardRow[] {
  return db.query('SELECT * FROM port_forwards ORDER BY container_port').all() as PortForwardRow[];
}

export function insertForward(row: PortForwardRow): void {
  db.query(
    `INSERT INTO port_forwards (instance_id, container_port, host_port, created_at)
     VALUES ($instance_id, $container_port, $host_port, $created_at)`,
  ).run({
    $instance_id: row.instance_id,
    $container_port: row.container_port,
    $host_port: row.host_port,
    $created_at: row.created_at,
  });
}

export function deleteForward(instanceId: string, containerPort: number): void {
  db.query(
    'DELETE FROM port_forwards WHERE instance_id = $id AND container_port = $port',
  ).run({ $id: instanceId, $port: containerPort });
}

export function deleteForwards(instanceId: string): void {
  db.query('DELETE FROM port_forwards WHERE instance_id = $id').run({ $id: instanceId });
}

/** Columns `updateInstance` may patch, paired with their bind-parameter names. */
const UPDATABLE_COLUMNS = [
  'name',
  'container_id',
  'remote_workspace_folder',
  'status',
  'error',
  'remote_user',
  'image_source',
] as const;

type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number];

export function updateInstance(
  id: string,
  patch: Partial<Pick<InstanceRow, UpdatableColumn>>,
): void {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { $id: id };
  for (const col of UPDATABLE_COLUMNS) {
    if (col in patch) {
      sets.push(`${col} = $${col}`);
      params[`$${col}`] = patch[col] ?? null;
    }
  }
  if (sets.length === 0) return;
  db.query(`UPDATE instances SET ${sets.join(', ')} WHERE id = $id`).run(params);
}

export function deleteInstanceRow(id: string): void {
  db.query('DELETE FROM instances WHERE id = $id').run({ $id: id });
}

/** Record (or refresh) a source folder in the re-creation history. */
export function recordFolder(source_path: string, name: string): void {
  db.query(
    `INSERT INTO folder_history (source_path, name, last_used_at)
     VALUES ($source_path, $name, $last_used_at)
     ON CONFLICT(source_path) DO UPDATE SET
       name = excluded.name,
       last_used_at = excluded.last_used_at`,
  ).run({ $source_path: source_path, $name: name, $last_used_at: Date.now() });
}

export function listFolderHistory(): FolderHistoryRow[] {
  return db
    .query('SELECT * FROM folder_history ORDER BY last_used_at DESC')
    .all() as FolderHistoryRow[];
}

export function deleteFolderHistory(source_path: string): void {
  db.query('DELETE FROM folder_history WHERE source_path = $source_path').run({
    $source_path: source_path,
  });
}

/** Read a key/value app option, or null when unset. */
export function getOption(key: string): string | null {
  const row = db.query('SELECT value FROM options WHERE key = $key').get({ $key: key }) as
    | { value: string }
    | null;
  return row?.value ?? null;
}

/** Set (or overwrite) a key/value app option. */
export function setOption(key: string, value: string): void {
  db.query(
    `INSERT INTO options (key, value)
     VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run({ $key: key, $value: value });
}
