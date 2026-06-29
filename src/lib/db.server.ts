import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { DATA_DIR, DB_PATH } from './config.server.ts';

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
}

// Pin the connection to globalThis so dev-mode hot reload doesn't reopen it.
const globalForDb = globalThis as unknown as { __dcmDb?: Database };

function open(): Database {
  mkdirSync(DATA_DIR, { recursive: true });
  const database = new Database(DB_PATH, { create: true });
  database.run('PRAGMA journal_mode = WAL;');
  database.run(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      host_port INTEGER NOT NULL,
      container_id TEXT,
      remote_workspace_folder TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      bridge_token TEXT NOT NULL DEFAULT '',
      remote_user TEXT
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS folder_history (
      source_path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_used_at INTEGER NOT NULL
    );
  `);
  // Migrate databases created before remote_workspace_folder existed.
  const cols = database.query('PRAGMA table_info(instances)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'remote_workspace_folder')) {
    database.run('ALTER TABLE instances ADD COLUMN remote_workspace_folder TEXT;');
  }
  // Migrate databases created before the attention bridge existed.
  if (!cols.some((c) => c.name === 'bridge_token')) {
    database.run("ALTER TABLE instances ADD COLUMN bridge_token TEXT NOT NULL DEFAULT '';");
  }
  // Migrate databases created before the container user was recorded.
  if (!cols.some((c) => c.name === 'remote_user')) {
    database.run('ALTER TABLE instances ADD COLUMN remote_user TEXT;');
  }
  return database;
}

export const db: Database = (globalForDb.__dcmDb ??= open());

export function insertInstance(row: InstanceRow): void {
  db.query(
    `INSERT INTO instances
       (id, name, source_path, workspace_path, host_port, container_id, remote_workspace_folder, status, error, created_at, bridge_token, remote_user)
     VALUES ($id, $name, $source_path, $workspace_path, $host_port, $container_id, $remote_workspace_folder, $status, $error, $created_at, $bridge_token, $remote_user)`,
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
  });
}

export function getInstance(id: string): InstanceRow | null {
  return db.query('SELECT * FROM instances WHERE id = $id').get({ $id: id }) as InstanceRow | null;
}

export function allInstances(): InstanceRow[] {
  return db.query('SELECT * FROM instances ORDER BY created_at DESC').all() as InstanceRow[];
}

export function usedPorts(): number[] {
  const rows = db.query('SELECT host_port FROM instances').all() as { host_port: number }[];
  return rows.map((r) => r.host_port);
}

export function updateInstance(
  id: string,
  patch: Partial<
    Pick<
      InstanceRow,
      | 'name'
      | 'container_id'
      | 'remote_workspace_folder'
      | 'status'
      | 'error'
      | 'remote_user'
    >
  >,
): void {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { $id: id };
  if ('name' in patch) {
    sets.push('name = $name');
    params.$name = patch.name ?? null;
  }
  if ('container_id' in patch) {
    sets.push('container_id = $container_id');
    params.$container_id = patch.container_id ?? null;
  }
  if ('remote_workspace_folder' in patch) {
    sets.push('remote_workspace_folder = $remote_workspace_folder');
    params.$remote_workspace_folder = patch.remote_workspace_folder ?? null;
  }
  if ('status' in patch) {
    sets.push('status = $status');
    params.$status = patch.status ?? null;
  }
  if ('error' in patch) {
    sets.push('error = $error');
    params.$error = patch.error ?? null;
  }
  if ('remote_user' in patch) {
    sets.push('remote_user = $remote_user');
    params.$remote_user = patch.remote_user ?? null;
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
