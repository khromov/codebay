import { rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
	CODE_SERVER_PORT,
	DATA_DIR,
	DEFAULT_COPY_IGNORE,
	DEFAULT_IMAGE,
	INSTANCES_DIR,
	parseCopyIgnore,
	TTYD_PORT
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
	type InstanceMode,
	type InstanceRow,
	type InstanceStatus
} from './db.server.ts';
import {
	dockerAvailable,
	hostPortsInUse,
	isRunning,
	removeContainer,
	startContainer,
	stopContainer
} from './docker.server.ts';
import {
	copyWorkspace,
	devcontainerCliAvailable,
	devcontainerUp,
	INJECTIONS_DONE_FILE,
	readDeclaredContainerPorts,
	writeOverrideConfig
} from './devcontainer.server.ts';
import { writeContainerFile } from './container-files.server.ts';
import { clearAttention, getAttention } from './bridge.server.ts';
import { proxyPathFor } from './proxy.server.ts';
import { resolveInjections } from './injections.server.ts';
import { cloneRepo, readGitBranch } from './git.server.ts';
import { isRepoUrl, parseRepoUrl } from './repo-url.ts';
import { currentHealthSnapshots, stopHealthMonitor, syncHealthMonitors } from './health.server.ts';
import { pickFreePort } from './ports.server.ts';
import type { ServerWebSocket } from 'bun';
import {
	isInstanceFilter,
	normalizeMode,
	type Instance,
	type InstanceFilter,
	type InstanceHealth
} from '../types.ts';

/**
 * `bridge_token` authenticates the no-Basic-Auth `/api/bridge/` endpoint, so it
 * must never reach the browser — every row handed to a route goes through here.
 */
export function sanitizeInstance(row: InstanceRow): Omit<InstanceRow, 'bridge_token'> {
	const { bridge_token: _token, ...rest } = row;
	return rest;
}

interface LiveState {
	logs: string[];
	subscribers: Set<(chunk: string) => void>;
}

const globalForReg = globalThis as unknown as { __codebayRegistry?: Map<string, LiveState> };
const registry: Map<string, LiveState> = (globalForReg.__codebayRegistry ??= new Map());

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
	// Materializing an entry for an unknown id would let callers grow the registry unbounded.
	if (!registry.has(id) && !getInstance(id)) return () => {};
	const state = live(id);
	for (const line of state.logs) onChunk(line);
	state.subscribers.add(onChunk);
	return () => state.subscribers.delete(onChunk);
}

export type StreamEvent =
	| { type: 'instances'; data: Instance[] }
	| { type: 'health'; data: { id: string; health: InstanceHealth } }
	| { type: 'preflight'; data: { docker: boolean; cli: boolean } }
	// `name` is the chosen sprite, or null for the default box logo. Lets the header swap live.
	| { type: 'pet'; data: { name: string | null } }
	// The dashboard run-state filter, so a change in one tab propagates to every open client.
	| { type: 'filter'; data: { value: InstanceFilter } };

interface StreamHub {
	sockets: Set<ServerWebSocket<unknown>>;
	timer: ReturnType<typeof setInterval> | null;
	lastListJson: string;
	lastPreflightJson: string;
}

const globalForHub = globalThis as unknown as { __codebayHub?: StreamHub };
const hub: StreamHub = (globalForHub.__codebayHub ??= {
	sockets: new Set(),
	timer: null,
	lastListJson: '',
	lastPreflightJson: ''
});

/** Docker + CLI only; auth stays SSR-only. */
async function backgroundPreflight(): Promise<{ docker: boolean; cli: boolean }> {
	const [docker, cli] = await Promise.all([dockerAvailable(), devcontainerCliAvailable()]);
	return { docker, cli };
}

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

export function broadcastHealth(id: string, health: InstanceHealth): void {
	broadcast({ type: 'health', data: { id, health } });
}

/** Called from the settings action so every open dashboard swaps its header logo without a reload. */
export function broadcastPet(name: string | null): void {
	broadcast({ type: 'pet', data: { name } });
}

/** Called when the filter changes so every open dashboard reflects it without a reload. */
export function broadcastFilter(value: InstanceFilter): void {
	broadcast({ type: 'filter', data: { value } });
}

async function reconcileInstances(force = false): Promise<void> {
	const list = await listInstances();
	const listJson = JSON.stringify(list);
	if (force || listJson !== hub.lastListJson) {
		hub.lastListJson = listJson;
		broadcast({ type: 'instances', data: list });
	}
}

/** Spawns a process, so only the periodic tick calls this — never `triggerReconcile`. */
async function reconcilePreflight(): Promise<void> {
	const pf = await backgroundPreflight();
	const pfJson = JSON.stringify(pf);
	if (pfJson !== hub.lastPreflightJson) {
		hub.lastPreflightJson = pfJson;
		broadcast({ type: 'preflight', data: pf });
	}
}

async function reconcileAndBroadcast(): Promise<void> {
	await reconcileInstances();
	await reconcilePreflight();
}

/**
 * Deliberately skips preflight: this fires on every attention-bridge ping, so
 * re-probing the CLI here would spawn a process per Claude tool-call boundary.
 */
export function triggerReconcile(): void {
	void reconcileInstances(true);
}

export function streamOpen(ws: ServerWebSocket<unknown>): void {
	hub.sockets.add(ws);
	if (!hub.timer) hub.timer = setInterval(() => void reconcileAndBroadcast(), 5000);
	// Seed everything up front so a fresh or reconnected client is correct without waiting a tick.
	void listInstances().then((list) => sendTo(ws, { type: 'instances', data: list }));
	for (const snap of currentHealthSnapshots()) sendTo(ws, { type: 'health', data: snap });
	void backgroundPreflight().then((pf) => sendTo(ws, { type: 'preflight', data: pf }));
	// Keeps a reconnecting client correct even if the pet changed while it was away.
	sendTo(ws, { type: 'pet', data: { name: getOption('pet') || null } });
	// Same, for the filter, so a client that reconnects picks up a change made while it was away.
	const savedFilter = getOption('instance_filter');
	sendTo(ws, {
		type: 'filter',
		data: { value: isInstanceFilter(savedFilter) ? savedFilter : 'all' }
	});
}

export function streamClose(ws: ServerWebSocket<unknown>): void {
	hub.sockets.delete(ws);
	if (hub.sockets.size === 0 && hub.timer) {
		clearInterval(hub.timer);
		hub.timer = null;
	}
}

// Bridges the gap between allocating a port and persisting it, so two concurrent
// allocations can't pick the same DB-free port; the TTL stops a failed insert from
// leaking that port out of the range forever.
const RESERVATION_TTL_MS = 60_000;
const globalForPorts = globalThis as unknown as { __codebayReservedPorts?: Map<number, number> };
const reservedPorts: Map<number, number> = (globalForPorts.__codebayReservedPorts ??= new Map());

async function allocatePort(): Promise<number> {
	const dbPorts = new Set(usedPorts());
	// A container can outlive its DB row, so ask Docker what's actually published too.
	const dockerPorts = new Set(await hostPortsInUse());
	const now = Date.now();
	for (const [port, reservedAt] of reservedPorts) {
		if (dbPorts.has(port) || now - reservedAt > RESERVATION_TTL_MS) reservedPorts.delete(port);
	}
	const port = pickFreePort([dbPorts, dockerPorts, new Set(reservedPorts.keys())]);
	reservedPorts.set(port, now);
	return port;
}

async function assertDir(path: string): Promise<void> {
	let info;
	try {
		info = await stat(path);
	} catch {
		throw new Error(`Folder does not exist: ${path}`);
	}
	if (!info.isDirectory()) throw new Error(`Not a folder: ${path}`);
}

function failInstance(id: string, err: unknown): void {
	const message = (err as Error).message;
	updateInstance(id, { status: 'error', error: message });
	appendLog(id, `\n✗ Error: ${message}\n`);
	triggerReconcile();
}

async function boot(row: InstanceRow, opts: { branch?: string } = {}): Promise<void> {
	try {
		if (isRepoUrl(row.source_path)) {
			appendLog(row.id, `Cloning ${row.source_path} → ${row.workspace_path}\n`);
			await cloneRepo(row.source_path, row.workspace_path, (chunk) => appendLog(row.id, chunk), {
				branch: opts.branch
			});
		} else {
			appendLog(row.id, `Copying ${row.source_path} → ${row.workspace_path}\n`);
			const ignore = parseCopyIgnore(getOption('copy_ignore_patterns') ?? DEFAULT_COPY_IGNORE);
			await copyWorkspace(row.source_path, row.workspace_path, ignore);
		}
		await seedDeclaredPorts(row);
	} catch (err) {
		failInstance(row.id, err);
		return;
	}
	await provision(row);
}

/** Must run before config injection, while the copied `devcontainer.json` is still pristine. */
async function seedDeclaredPorts(row: InstanceRow): Promise<void> {
	const existing = new Set(listForwards(row.id).map((f) => f.container_port));
	for (const containerPort of await readDeclaredContainerPorts(row.workspace_path)) {
		if (existing.has(containerPort)) continue;
		const hostPort = await allocatePort();
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

/** Never re-copies the workspace, so in-container edits survive a rebuild. */
async function provision(row: InstanceRow, opts: { noCache?: boolean } = {}): Promise<void> {
	try {
		const forwards = listForwards(row.id).map((f) => ({
			container_port: f.container_port,
			host_port: f.host_port
		}));
		const surface = row.mode === 'terminal' ? 'ttyd terminal' : 'code-server';
		appendLog(row.id, `Injecting ${surface} (host port ${row.host_port})\n`);
		const defaultImage = getOption('default_image') ?? DEFAULT_IMAGE;
		const { imageSource } = await writeOverrideConfig(
			row.workspace_path,
			row.host_port,
			forwards,
			defaultImage,
			row.mode
		);
		updateInstance(row.id, { image_source: imageSource });

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

		// updateInstance writes the DB, not `row`; mirror the fields so `target.instance`
		// (e.g. remote_workspace_folder, which claude-trust keys on) isn't the stale pre-boot row.
		row.container_id = result.containerId;
		row.remote_workspace_folder = result.remoteWorkspaceFolder ?? null;
		row.remote_user = result.remoteUser ?? null;
		row.status = 'running';

		const target = {
			containerId: result.containerId,
			remoteUser: result.remoteUser,
			instance: row
		};
		// Swallow per-injection failures so one bad injection can't abort the rest of provisioning.
		for (const injection of resolveInjections(row.mode)) {
			try {
				await injection.apply(target, (msg) => appendLog(row.id, msg));
			} catch (err) {
				appendLog(row.id, `⚠ ${injection.label} injection failed: ${(err as Error).message}\n`);
			}
		}

		// Unblocks the terminal launcher's wait; written even after ⚠s — its timeout is the fallback.
		await writeContainerFile(target, { dir: '$HOME', name: INJECTIONS_DONE_FILE }, 'done\n').catch(
			() => undefined
		);

		appendLog(row.id, `\n✓ Instance running — open it via the proxy at ${proxyPathFor(row.id)}\n`);
		triggerReconcile();
	} catch (err) {
		failInstance(row.id, err);
	}
}

/** The first instance keeps the bare name; later collisions get a `#2`, `#3`, … suffix. */
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

/** The global fallback the picker's mode toggle starts on; a per-instance choice overrides it. */
export function getDefaultMode(): InstanceMode {
	return normalizeMode(getOption('default_mode'));
}

/** `source` is either a local folder (copied) or a Git URL (cloned); boot runs in the background. */
export async function createInstance(
	source: string,
	name?: string,
	opts: { branch?: string; mode?: InstanceMode } = {}
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
	const hostPort = await allocatePort();
	const row: InstanceRow = {
		id,
		name: uniqueName(name?.trim() || folderName),
		source_path: source,
		workspace_path: join(INSTANCES_DIR, id, folderName),
		host_port: hostPort,
		container_id: null,
		remote_workspace_folder: null,
		status: 'creating',
		error: null,
		created_at: Date.now(),
		bridge_token: crypto.randomUUID().replace(/-/g, ''),
		remote_user: null,
		image_source: null,
		mode: opts.mode ?? getDefaultMode()
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
	// Polled rather than persisted, because the branch changes inside the container.
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
			// The workspace is bind-mounted, so the host copy's .git/HEAD tracks the container.
			branches.set(row.id, await readGitBranch(row.workspace_path));
		})
	);
	// Reconcile is the only place that knows the current running set.
	syncHealthMonitors(rows);
	// Distinguishes a forward that's live from one still pending a rebuild.
	const openPorts = new Map<string, Set<number>>();
	for (const { id, health } of currentHealthSnapshots()) {
		openPorts.set(id, new Set(health.openPorts));
	}
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

/** Only persists the mapping — `rebuildInstance` is what actually publishes it. */
export async function addForwardedPort(id: string, containerPort: number): Promise<InstanceRow> {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
		throw new Error('Port must be an integer between 1 and 65535');
	}
	const reserved = row.mode === 'terminal' ? TTYD_PORT : CODE_SERVER_PORT;
	if (containerPort === reserved) {
		throw new Error(
			`Port ${reserved} is reserved for ${row.mode === 'terminal' ? 'the terminal' : 'code-server'}`
		);
	}
	if (listForwards(id).some((f) => f.container_port === containerPort)) {
		throw new Error(`Port ${containerPort} is already forwarded`);
	}
	insertForward({
		instance_id: id,
		container_port: containerPort,
		host_port: await allocatePort(),
		created_at: Date.now()
	});
	triggerReconcile();
	return getInstance(id)!;
}

/** Only persists the removal — `rebuildInstance` is what actually unpublishes it. */
export function removeForwardedPort(id: string, containerPort: number): InstanceRow {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	deleteForward(id, containerPort);
	triggerReconcile();
	return getInstance(id)!;
}

/** Recreates the container, but not the workspace copy, so in-container edits survive. */
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

/** Returns how many rebuilds were kicked off; each runs in the background. */
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

/** The exit is deferred so the HTTP response can flush before the server dies. */
export async function deleteDatabaseAndShutdown(): Promise<void> {
	await deleteAllInstances();
	closeDb();
	await rm(DATA_DIR, { recursive: true, force: true });
	setTimeout(() => process.exit(0), 150);
}
