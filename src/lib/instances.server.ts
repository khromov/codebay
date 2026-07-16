import { rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
	CODE_SERVER_PORT,
	DATA_DIR,
	DEFAULT_IMAGE,
	INSTANCES_DIR,
	PORT_BASE,
	PORT_MAX
} from './config.server.ts';
import {
	allForwards,
	allInstances,
	closeDb,
	deleteForward,
	deleteForwards,
	deleteInstanceRow,
	getInstance,
	getOption,
	insertForward,
	insertInstance,
	listForwards,
	recordFolder,
	updateInstance,
	usedPorts,
	type InstanceRow,
	type InstanceStatus
} from './db.server.ts';
import {
	dockerAvailable,
	isRunning,
	removeContainer,
	startContainer,
	stopContainer
} from './docker.server.ts';
import {
	copyWorkspace,
	devcontainerCliAvailable,
	devcontainerUp,
	readDeclaredContainerPorts,
	writeOverrideConfig
} from './devcontainer.server.ts';
import { clearAttention, getAttention } from './bridge.server.ts';
import { proxyPathFor } from './proxy.server.ts';
import { injections } from './injections.server.ts';
import { cloneRepo, readGitBranch } from './git.server.ts';
import { isRepoUrl, parseRepoUrl } from './repo-url.ts';
import { currentHealthSnapshots, stopHealthMonitor, syncHealthMonitors } from './health.server.ts';
import type { ServerWebSocket } from 'bun';
import type { Instance, InstanceHealth } from '../types.ts';

/**
 * Client-safe instance shape: every field except `bridge_token`, a
 * container-only secret (it authenticates the no-Basic-Auth `/api/bridge/`
 * endpoint) that must never reach the browser. Every server function that
 * hands an instance row back to a route must pass it through this first —
 * `listInstances()` below does, and `routes.ts` does the same for every
 * mutator (rename, start/stop, ports, rebuild, create) that returns a row.
 */
export function sanitizeInstance(row: InstanceRow): Omit<InstanceRow, 'bridge_token'> {
	const { bridge_token: _token, ...rest } = row;
	return rest;
}

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
	// Never materialize a registry entry for an id that was never booted and isn't
	// a known instance — otherwise an unknown id could grow the registry unbounded.
	if (!registry.has(id) && !getInstance(id)) return () => {};
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
	| { type: 'health'; data: { id: string; health: InstanceHealth } }
	| { type: 'preflight'; data: { docker: boolean; cli: boolean } };

interface StreamHub {
	sockets: Set<ServerWebSocket<unknown>>;
	timer: ReturnType<typeof setInterval> | null;
	lastListJson: string;
	lastPreflightJson: string;
}

const globalForHub = globalThis as unknown as { __dcmHub?: StreamHub };
const hub: StreamHub = (globalForHub.__dcmHub ??= {
	sockets: new Set(),
	timer: null,
	lastListJson: '',
	lastPreflightJson: ''
});

/** Background preflight subset — docker + CLI only; auth stays SSR-only. */
async function backgroundPreflight(): Promise<{ docker: boolean; cli: boolean }> {
	const [docker, cli] = await Promise.all([dockerAvailable(), devcontainerCliAvailable()]);
	return { docker, cli };
}

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

/** Refresh the instance list and, if it changed (or `force`), broadcast it. */
async function reconcileInstances(force = false): Promise<void> {
	const list = await listInstances();
	const listJson = JSON.stringify(list);
	if (force || listJson !== hub.lastListJson) {
		hub.lastListJson = listJson;
		broadcast({ type: 'instances', data: list });
	}
}

/**
 * Refresh docker/CLI preflight and, if it changed, broadcast it. Spawns a
 * process (`devcontainer --version`, see `devcontainerCliAvailable`), so this
 * is only ever called from the periodic tick below — never from
 * `triggerReconcile`, which fires on every attention-bridge ping.
 */
async function reconcilePreflight(): Promise<void> {
	const pf = await backgroundPreflight();
	const pfJson = JSON.stringify(pf);
	if (pfJson !== hub.lastPreflightJson) {
		hub.lastPreflightJson = pfJson;
		broadcast({ type: 'preflight', data: pf });
	}
}

/** Periodic tick (every 5s, see `streamOpen`): refresh both the instance list and preflight. */
async function reconcileAndBroadcast(): Promise<void> {
	await reconcileInstances();
	await reconcilePreflight();
}

/**
 * Notify all clients that the instance list changed (immediate push). Refreshes
 * only the instance list, not the docker/CLI preflight: `triggerReconcile` is
 * called from high-frequency paths too — every mutation, but also every
 * attention-bridge ping, i.e. every Claude `Stop`/`Notification`/
 * `UserPromptSubmit` hook event across every running instance. Re-probing the
 * CLI on each of those would mean spawning a `devcontainer --version` process
 * on essentially every Claude tool-call boundary; the periodic tick above
 * keeps preflight fresh (every 5s) without that cost.
 */
export function triggerReconcile(): void {
	void reconcileInstances(true);
}

/** A new `/api/stream` socket connected: register it, seed it, and ensure the tick runs. */
export function streamOpen(ws: ServerWebSocket<unknown>): void {
	hub.sockets.add(ws);
	if (!hub.timer) hub.timer = setInterval(() => void reconcileAndBroadcast(), 5000);
	// Seed the freshly-connected client: full list now, plus whatever health we
	// already have. Newly-running instances fill in on the next monitor tick.
	void listInstances().then((list) => sendTo(ws, { type: 'instances', data: list }));
	for (const snap of currentHealthSnapshots()) sendTo(ws, { type: 'health', data: snap });
	// Seed current preflight so a fresh/reconnected client is correct without waiting a tick.
	void backgroundPreflight().then((pf) => sendTo(ws, { type: 'preflight', data: pf }));
}

/** A `/api/stream` socket closed: unregister it and stop the tick when idle. */
export function streamClose(ws: ServerWebSocket<unknown>): void {
	hub.sockets.delete(ws);
	if (hub.sockets.size === 0 && hub.timer) {
		clearInterval(hub.timer);
		hub.timer = null;
	}
}

// --- Host-port allocation --------------------------------------------------
// `usedPorts()` reads the DB, but a port isn't in the DB until its row/forward is
// inserted — and inserts can lag the allocation (e.g. the seed loop computes a
// port, then inserts; `createInstance` allocates host_port well before its row is
// written). Two concurrent allocations could therefore both pick the same "free"
// port. We additionally hold a short-lived in-memory reservation set, pinned to
// globalThis (survives dev hot-reload), and union it with the DB ports so each
// allocation sees the ones still in flight. Reservations that have since landed
// in the DB are pruned on every call, so the set never grows unbounded.
//
// Each reservation also carries the time it was made. A reservation only needs to
// bridge the gap until its row/forward is inserted (milliseconds, and always the
// very next statement in every caller); if that insert never happens — e.g. boot
// fails before persisting a seeded forward — the reservation would otherwise stay
// forever and permanently shrink the range. So we also drop any reservation older
// than the TTL: far longer than any real allocate→insert gap, but a hard backstop
// against leaking the range on a failed insert.
const RESERVATION_TTL_MS = 60_000;
const globalForPorts = globalThis as unknown as { __dcmReservedPorts?: Map<number, number> };
const reservedPorts: Map<number, number> = (globalForPorts.__dcmReservedPorts ??= new Map());

function allocatePort(): number {
	const dbPorts = new Set(usedPorts());
	const now = Date.now();
	// Drop reservations that have already been persisted (now covered by the DB set)
	// or that have aged past the TTL (their insert never landed) — either way keeping
	// them reserved would only leak the range.
	for (const [port, reservedAt] of reservedPorts) {
		if (dbPorts.has(port) || now - reservedAt > RESERVATION_TTL_MS) reservedPorts.delete(port);
	}
	for (let port = PORT_BASE; port <= PORT_MAX; port++) {
		if (!dbPorts.has(port) && !reservedPorts.has(port)) {
			reservedPorts.set(port, now);
			return port;
		}
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

/** Mark an instance failed: persist the error, log it, and re-broadcast the list. */
function failInstance(id: string, err: unknown): void {
	const message = (err as Error).message;
	updateInstance(id, { status: 'error', error: message });
	appendLog(id, `\n✗ Error: ${message}\n`);
	triggerReconcile();
}

/** Drive the first boot: fetch the workspace → seed declared ports → provision the container. */
async function boot(row: InstanceRow, opts: { branch?: string } = {}): Promise<void> {
	try {
		if (isRepoUrl(row.source_path)) {
			appendLog(row.id, `Cloning ${row.source_path} → ${row.workspace_path}\n`);
			await cloneRepo(row.source_path, row.workspace_path, (chunk) => appendLog(row.id, chunk), {
				branch: opts.branch
			});
		} else {
			appendLog(row.id, `Copying ${row.source_path} → ${row.workspace_path}\n`);
			await copyWorkspace(row.source_path, row.workspace_path);
		}
		await seedDeclaredPorts(row);
	} catch (err) {
		failInstance(row.id, err);
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
			created_at: Date.now()
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
async function provision(row: InstanceRow, opts: { noCache?: boolean } = {}): Promise<void> {
	try {
		const forwards = listForwards(row.id).map((f) => ({
			container_port: f.container_port,
			host_port: f.host_port
		}));
		appendLog(row.id, `Injecting code-server (host port ${row.host_port})\n`);
		const defaultImage = getOption('default_image') ?? DEFAULT_IMAGE;
		const { imageSource } = await writeOverrideConfig(
			row.workspace_path,
			row.host_port,
			forwards,
			defaultImage
		);
		updateInstance(row.id, { image_source: imageSource });

		// Build without cache when explicitly requested (e.g. "rebuild all without cache")
		// or when the global "disable build cache" setting is on — so it covers first boot too.
		const noCache = opts.noCache || getOption('disable_build_cache') === '1';
		if (noCache) appendLog(row.id, `Building without cache (--build-no-cache)\n`);

		appendLog(row.id, `Starting devcontainer…\n`);
		const result = await devcontainerUp(row.workspace_path, (chunk) => appendLog(row.id, chunk), {
			noCache
		});

		if (result.outcome !== 'success' || !result.containerId) {
			throw new Error(
				result.message || result.description || `devcontainer up failed (${result.outcome})`
			);
		}

		updateInstance(row.id, {
			container_id: result.containerId,
			remote_workspace_folder: result.remoteWorkspaceFolder ?? null,
			remote_user: result.remoteUser ?? null,
			status: 'running',
			error: null
		});

		// Run every injection (git safe.directory, credentials, attention hooks, …)
		// in registry order. Each logs its own progress; a thrown error is non-fatal
		// so one failed injection never aborts the rest of provisioning.
		const target = {
			containerId: result.containerId,
			remoteUser: result.remoteUser,
			instance: row
		};
		for (const injection of injections) {
			try {
				await injection.apply(target, (msg) => appendLog(row.id, msg));
			} catch (err) {
				appendLog(row.id, `⚠ ${injection.label} injection failed: ${(err as Error).message}\n`);
			}
		}

		appendLog(row.id, `\n✓ Instance running — open it via the proxy at ${proxyPathFor(row.id)}\n`);
		triggerReconcile();
	} catch (err) {
		failInstance(row.id, err);
	}
}

/**
 * Make `desired` unique against existing instance names by appending a
 * `#2`, `#3`, … suffix. The first instance keeps the bare name.
 */
function uniqueName(desired: string, excludeId?: string): string {
	const taken = new Set(
		allInstances()
			.filter((row) => row.id !== excludeId)
			.map((row) => row.name)
	);
	if (!taken.has(desired)) return desired;
	for (let n = 2; ; n++) {
		const candidate = `${desired} #${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * Create an instance row and kick off its boot in the background. `source` is
 * either a local folder path (copied) or a Git repository URL (cloned — see
 * `cloneRepo`); `opts.branch` selects a non-default branch for a repo source.
 */
export async function createInstance(
	source: string,
	name?: string,
	opts: { branch?: string } = {}
): Promise<InstanceRow> {
	const parsedRepo = parseRepoUrl(source);
	if (parsedRepo) {
		// Normalize to the clean https clone URL so re-picks from history dedupe.
		source = parsedRepo.cloneUrl;
	} else {
		await assertDir(source);
	}
	const id = crypto.randomUUID();
	const folderName = parsedRepo?.repo || basename(source) || 'workspace';
	const row: InstanceRow = {
		id,
		name: uniqueName(name?.trim() || folderName),
		source_path: source,
		workspace_path: join(INSTANCES_DIR, id, folderName),
		host_port: allocatePort(),
		container_id: null,
		remote_workspace_folder: null,
		status: 'creating',
		error: null,
		created_at: Date.now(),
		bridge_token: crypto.randomUUID().replace(/-/g, ''),
		remote_user: null,
		image_source: null
	};
	insertInstance(row);
	// Strip the de-dup `#2` suffix so the recent-folders list keeps the base name.
	recordFolder(source, row.name.replace(/ #\d+$/, ''));
	triggerReconcile();
	void boot(row, { branch: opts.branch });
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
		})
	);
	// Keep a background health monitor running for each live container (and retire
	// monitors for the rest) — reconcile is where we know the current running set.
	syncHealthMonitors(rows);
	// Ports the live container actually publishes, polled by the health monitor — used
	// to flag each configured forward as open vs not-yet-published (e.g. pending rebuild).
	const openPorts = new Map<string, Set<number>>();
	for (const { id, health } of currentHealthSnapshots()) {
		openPorts.set(id, new Set(health.openPorts));
	}
	// Group forwarded ports per instance in a single query (mirrors the branches map).
	const forwards = new Map<
		string,
		{ container_port: number; host_port: number; open: boolean }[]
	>();
	for (const f of allForwards()) {
		const list = forwards.get(f.instance_id) ?? [];
		list.push({
			container_port: f.container_port,
			host_port: f.host_port,
			open: openPorts.get(f.instance_id)?.has(f.container_port) ?? false
		});
		forwards.set(f.instance_id, list);
	}
	// Strip bridge_token — it's a container-only secret and must not reach the client.
	return rows.map((row) => ({
		...sanitizeInstance(row),
		git_branch: branches.get(row.id) ?? null,
		attention: getAttention(row.id),
		forwarded_ports: forwards.get(row.id) ?? []
	}));
}

export function renameInstance(id: string, name: string): InstanceRow {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Name cannot be empty');
	const unique = trimmed === row.name ? trimmed : uniqueName(trimmed, id);
	updateInstance(id, { name: unique });
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
		created_at: Date.now()
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
export function rebuildInstance(id: string, opts: { noCache?: boolean } = {}): InstanceRow {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	if (row.status === 'creating') return row; // a build is already in flight
	updateInstance(id, { status: 'creating', error: null });
	triggerReconcile();
	const fresh = getInstance(id)!;
	appendLog(
		id,
		opts.noCache ? `\n— Rebuilding without cache —\n` : `\n— Rebuilding to apply port changes —\n`
	);
	void provision(fresh, opts);
	return fresh;
}

/**
 * Rebuild every currently-running instance from scratch (no build cache). Stopped,
 * errored, and still-creating instances are left untouched. Each rebuild runs in the
 * background via `rebuildInstance`; returns how many were kicked off.
 */
export function rebuildRunningInstancesNoCache(): number {
	const running = allInstances().filter((r) => r.status === 'running' && r.container_id);
	for (const row of running) rebuildInstance(row.id, { noCache: true });
	return running.length;
}

export async function startInstance(id: string): Promise<InstanceRow> {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	if (!row.container_id) throw new Error('Instance has no container yet');
	const ok = await startContainer(row.container_id);
	updateInstance(id, {
		status: ok ? 'running' : 'error',
		error: ok ? null : 'Failed to start container'
	});
	triggerReconcile();
	return getInstance(id)!;
}

export async function stopInstance(id: string): Promise<InstanceRow> {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	const ok = row.container_id ? await stopContainer(row.container_id) : true;
	updateInstance(id, {
		status: ok ? 'stopped' : 'error',
		error: ok ? null : 'Failed to stop container'
	});
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
