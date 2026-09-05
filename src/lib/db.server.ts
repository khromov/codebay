import { Database } from 'bun:sqlite';
import { migrate, getMigrations } from '@zihaolam/bun-sqlite-migrations';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, DB_PATH } from './config.server.ts';
import type { AgentRunStatus, FolderHistoryEntry } from '../types.ts';

// db.server.ts lives in src/lib, so ../../migrations resolves to the repo root.
const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

export type InstanceStatus = 'creating' | 'running' | 'stopped' | 'error';

/** `'ide'` serves full code-server; `'terminal'` serves only ttyd + Claude Code. */
export type InstanceMode = 'ide' | 'terminal';

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
	/** `'local'` when the folder shipped its own config, else the injected image; null pre-dates this. */
	image_source: string | null;
	/** Sprite name chosen collision-free at creation; null pre-dates this and falls back to the id hash. */
	avatar: string | null;
	/** Fixed at creation: which editor surface this instance provisions and serves. */
	mode: InstanceMode;
	/** Terminal mode only: 1 when the scratch-shell pane was left open, so a reload restores it. */
	terminal_split: number;
	/** 0 until the legacy in-place config injection has been checked/undone; new rows start at 1. */
	config_migrated: number;
}

export interface PortForwardRow {
	instance_id: string;
	container_port: number;
	host_port: number;
	created_at: number;
}

// Pin the connection to globalThis so dev-mode hot reload doesn't reopen it.
const globalForDb = globalThis as unknown as { __codebayDb?: Database };

function open(): Database {
	mkdirSync(DATA_DIR, { recursive: true });
	const database = new Database(DB_PATH, { create: true });
	database.run('PRAGMA journal_mode = WAL;');
	migrate(database, getMigrations(MIGRATIONS_DIR));
	return database;
}

export const db: Database = (globalForDb.__codebayDb ??= open());

export function closeDb(): void {
	globalForDb.__codebayDb?.close();
	globalForDb.__codebayDb = undefined;
}

export function insertInstance(row: InstanceRow): void {
	db.query(
		`INSERT INTO instances
       (id, name, source_path, workspace_path, host_port, container_id, remote_workspace_folder, status, error, created_at, bridge_token, remote_user, image_source, avatar, mode, terminal_split, config_migrated)
     VALUES ($id, $name, $source_path, $workspace_path, $host_port, $container_id, $remote_workspace_folder, $status, $error, $created_at, $bridge_token, $remote_user, $image_source, $avatar, $mode, $terminal_split, $config_migrated)`
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
		$avatar: row.avatar,
		$mode: row.mode,
		$terminal_split: row.terminal_split,
		$config_migrated: row.config_migrated
	});
}

export function getInstance(id: string): InstanceRow | null {
	return db.query('SELECT * FROM instances WHERE id = $id').get({ $id: id }) as InstanceRow | null;
}

export function allInstances(): InstanceRow[] {
	return db.query('SELECT * FROM instances ORDER BY created_at DESC').all() as InstanceRow[];
}

export function usedPorts(): number[] {
	// Both tables publish host ports, so allocation has to see the union of them.
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
     VALUES ($instance_id, $container_port, $host_port, $created_at)`
	).run({
		$instance_id: row.instance_id,
		$container_port: row.container_port,
		$host_port: row.host_port,
		$created_at: row.created_at
	});
}

export function deleteForward(instanceId: string, containerPort: number): void {
	db.query('DELETE FROM port_forwards WHERE instance_id = $id AND container_port = $port').run({
		$id: instanceId,
		$port: containerPort
	});
}

export function deleteForwards(instanceId: string): void {
	db.query('DELETE FROM port_forwards WHERE instance_id = $id').run({ $id: instanceId });
}

/** The allowlist that keeps `updateInstance` from interpolating arbitrary column names. */
const UPDATABLE_COLUMNS = [
	'name',
	'container_id',
	'remote_workspace_folder',
	'status',
	'error',
	'remote_user',
	'image_source',
	'terminal_split',
	'config_migrated',
	// Reassigned when a rebuild finds the recorded port taken over on the host.
	'host_port'
] as const;

type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number];

export function updateInstance(
	id: string,
	patch: Partial<Pick<InstanceRow, UpdatableColumn>>
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

export function recordFolder(source_path: string, name: string): void {
	db.query(
		`INSERT INTO folder_history (source_path, name, last_used_at)
     VALUES ($source_path, $name, $last_used_at)
     ON CONFLICT(source_path) DO UPDATE SET
       name = excluded.name,
       last_used_at = excluded.last_used_at`
	).run({ $source_path: source_path, $name: name, $last_used_at: Date.now() });
}

export function listFolderHistory(): FolderHistoryEntry[] {
	return db
		.query('SELECT * FROM folder_history ORDER BY last_used_at DESC')
		.all() as FolderHistoryEntry[];
}

export function deleteFolderHistory(source_path: string): void {
	db.query('DELETE FROM folder_history WHERE source_path = $source_path').run({
		$source_path: source_path
	});
}

export function getOption(key: string): string | null {
	const row = db.query('SELECT value FROM options WHERE key = $key').get({ $key: key }) as {
		value: string;
	} | null;
	return row?.value ?? null;
}

export function setOption(key: string, value: string): void {
	db.query(
		`INSERT INTO options (key, value)
     VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).run({ $key: key, $value: value });
}

/** One `claude -p` invocation inside an instance, driven by the MCP server. */
export interface AgentRunRow {
	id: string;
	instance_id: string;
	prompt: string;
	status: AgentRunStatus;
	/** Claude's own session id, parsed out of the stream's `init` event; resumable. */
	session_id: string | null;
	/** The model Claude actually ran with, from the stream `init` event; the requested alias lives in `options`. */
	model: string | null;
	resume_session_id: string | null;
	/** JSON blob of the launch options, so a run queued before its container existed can still start. */
	options: string | null;
	result: string | null;
	/** JSON string, only when the caller passed a `--json-schema`. */
	structured_output: string | null;
	/** Latest tool call or assistant line, so a poller can see progress mid-run. */
	last_activity: string | null;
	is_error: number;
	exit_code: number | null;
	cost_usd: number | null;
	duration_ms: number | null;
	num_turns: number | null;
	error: string | null;
	created_at: number;
	started_at: number | null;
	finished_at: number | null;
}

/** Neither has finished, so both block a second run on the same instance. */
const OPEN_RUN_STATUSES = "('queued', 'running')";

export function insertRun(row: AgentRunRow): void {
	db.query(
		`INSERT INTO agent_runs
       (id, instance_id, prompt, status, session_id, model, resume_session_id, options, result, structured_output, last_activity, is_error, exit_code, cost_usd, duration_ms, num_turns, error, created_at, started_at, finished_at)
     VALUES ($id, $instance_id, $prompt, $status, $session_id, $model, $resume_session_id, $options, $result, $structured_output, $last_activity, $is_error, $exit_code, $cost_usd, $duration_ms, $num_turns, $error, $created_at, $started_at, $finished_at)`
	).run({
		$id: row.id,
		$instance_id: row.instance_id,
		$prompt: row.prompt,
		$status: row.status,
		$session_id: row.session_id,
		$model: row.model,
		$resume_session_id: row.resume_session_id,
		$options: row.options,
		$result: row.result,
		$structured_output: row.structured_output,
		$last_activity: row.last_activity,
		$is_error: row.is_error,
		$exit_code: row.exit_code,
		$cost_usd: row.cost_usd,
		$duration_ms: row.duration_ms,
		$num_turns: row.num_turns,
		$error: row.error,
		$created_at: row.created_at,
		$started_at: row.started_at,
		$finished_at: row.finished_at
	});
}

export function getRun(id: string): AgentRunRow | null {
	return db.query('SELECT * FROM agent_runs WHERE id = $id').get({ $id: id }) as AgentRunRow | null;
}

export function listRuns(instanceId: string, limit = 50): AgentRunRow[] {
	return db
		.query('SELECT * FROM agent_runs WHERE instance_id = $id ORDER BY created_at DESC LIMIT $limit')
		.all({ $id: instanceId, $limit: limit }) as AgentRunRow[];
}

/** Every unfinished run, across all instances — what the poller's timer works from. */
export function openRuns(): AgentRunRow[] {
	return db
		.query(`SELECT * FROM agent_runs WHERE status IN ${OPEN_RUN_STATUSES} ORDER BY created_at`)
		.all() as AgentRunRow[];
}

export function openRunFor(instanceId: string): AgentRunRow | null {
	return db
		.query(
			`SELECT * FROM agent_runs WHERE instance_id = $id AND status IN ${OPEN_RUN_STATUSES} ORDER BY created_at LIMIT 1`
		)
		.get({ $id: instanceId }) as AgentRunRow | null;
}

/** The same allowlist discipline `updateInstance` uses — never interpolate a caller's column name. */
const UPDATABLE_RUN_COLUMNS = [
	'status',
	'session_id',
	'model',
	'result',
	'structured_output',
	'last_activity',
	'is_error',
	'exit_code',
	'cost_usd',
	'duration_ms',
	'num_turns',
	'error',
	'started_at',
	'finished_at'
] as const;

type UpdatableRunColumn = (typeof UPDATABLE_RUN_COLUMNS)[number];

export function updateRun(id: string, patch: Partial<Pick<AgentRunRow, UpdatableRunColumn>>): void {
	const sets: string[] = [];
	const params: Record<string, string | number | null> = { $id: id };
	for (const col of UPDATABLE_RUN_COLUMNS) {
		if (col in patch) {
			sets.push(`${col} = $${col}`);
			params[`$${col}`] = patch[col] ?? null;
		}
	}
	if (sets.length === 0) return;
	db.query(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = $id`).run(params);
}

export function deleteRuns(instanceId: string): void {
	db.query('DELETE FROM agent_runs WHERE instance_id = $id').run({ $id: instanceId });
}
