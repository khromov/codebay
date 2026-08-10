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
	launchCommandFor,
	readDeclaredContainerPorts,
	TERMINAL_LAUNCHED_MARKER,
	writeOverrideConfig
} from './devcontainer.server.ts';
import { writeContainerFile } from './container-files.server.ts';
import { execInContainer } from './exec.server.ts';
import { clearAttention, getAttention } from './bridge.server.ts';
import { proxyPathFor } from './proxy.server.ts';
import { resolveInjectionStages } from './injections.server.ts';
import { cloneRepo, readGitBranch } from './git.server.ts';
import { isRepoUrl, parseRepoUrl } from './repo-url.ts';
import { getClaudePermissionMode } from '../container-injections/claude-permission-mode.ts';
import {
	currentHealthSnapshots,
	stopHealthMonitor,
	surfaceAccessible,
	syncHealthMonitors
} from './health.server.ts';
import { stopLogCapture, syncLogCapture } from './log-capture.server.ts';
import { isHostPortBindable, pickBindablePort } from './ports.server.ts';
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
	| { type: 'filter'; data: { value: InstanceFilter } }
	// The global default editor surface, so the picker's toggle follows a settings change.
	| { type: 'default-mode'; data: { mode: InstanceMode } };

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

/** Settings opens in its own popup, so the dashboard behind it needs the new default pushed. */
export function broadcastDefaultMode(mode: InstanceMode): void {
	broadcast({ type: 'default-mode', data: { mode } });
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
	// Same, for the default mode the picker's toggle seeds from.
	sendTo(ws, { type: 'default-mode', data: { mode: getDefaultMode() } });
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
	const port = await pickBindablePort(
		[dbPorts, dockerPorts, new Set(reservedPorts.keys())],
		isHostPortBindable
	);
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

function elapsed(startMs: number): string {
	return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

function failInstance(id: string, err: unknown): void {
	const message = (err as Error).message;
	updateInstance(id, { status: 'error', error: message });
	appendLog(id, `\n✗ Error: ${message}\n`);
	triggerReconcile();
}

async function boot(row: InstanceRow, opts: { branch?: string } = {}): Promise<void> {
	try {
		const sourceStart = Date.now();
		if (isRepoUrl(row.source_path)) {
			appendLog(row.id, `Cloning ${row.source_path} → ${row.workspace_path}\n`);
			await cloneRepo(row.source_path, row.workspace_path, (chunk) => appendLog(row.id, chunk), {
				branch: opts.branch
			});
			appendLog(row.id, `⏱ clone: ${elapsed(sourceStart)}\n`);
		} else {
			appendLog(row.id, `Copying ${row.source_path} → ${row.workspace_path}\n`);
			const ignore = parseCopyIgnore(getOption('copy_ignore_patterns') ?? DEFAULT_COPY_IGNORE);
			await copyWorkspace(row.source_path, row.workspace_path, ignore);
			appendLog(row.id, `⏱ copy: ${elapsed(sourceStart)}\n`);
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

const surfaceLabel = (mode: InstanceMode) =>
	mode === 'terminal' ? 'ttyd terminal' : 'code-server';

/**
 * Moves an instance off a host port that something outside Docker has taken over, which otherwise
 * strands it forever — the container publishes fine but nothing reaches it from the host. Requires
 * the port to be *both* unbindable and dead, because a rebuild doesn't stop the old container
 * first: a healthy instance's port is always unbindable here, and its surface still answers.
 */
async function rescueHijackedPort(row: InstanceRow): Promise<void> {
	if (await isHostPortBindable(row.host_port)) return;
	if (await surfaceAccessible(row.host_port)) return;
	const stale = row.host_port;
	const port = await allocatePort();
	updateInstance(row.id, { host_port: port });
	row.host_port = port;
	appendLog(
		row.id,
		`⚠ Host port ${stale} is held by another process and isn't reachable — moving to ${port}\n`
	);
}

/** Never re-copies the workspace, so in-container edits survive a rebuild. */
async function provision(row: InstanceRow, opts: { noCache?: boolean } = {}): Promise<void> {
	try {
		await rescueHijackedPort(row);
		const forwards = listForwards(row.id).map((f) => ({
			container_port: f.container_port,
			host_port: f.host_port
		}));
		appendLog(row.id, `Injecting ${surfaceLabel(row.mode)} (host port ${row.host_port})\n`);
		const defaultImage = getOption('default_image') ?? DEFAULT_IMAGE;
		const { imageSource } = await writeOverrideConfig(
			row.workspace_path,
			row.host_port,
			forwards,
			defaultImage,
			row.mode,
			getClaudePermissionMode()
		);
		updateInstance(row.id, { image_source: imageSource });

		const noCache = opts.noCache || getOption('disable_build_cache') === '1';
		if (noCache) appendLog(row.id, `Building without cache (--build-no-cache)\n`);

		appendLog(row.id, `Starting devcontainer…\n`);
		const upStart = Date.now();
		const result = await devcontainerUp(row.workspace_path, (chunk) => appendLog(row.id, chunk), {
			noCache
		});
		appendLog(row.id, `⏱ devcontainer up: ${elapsed(upStart)}\n`);

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

		// Start the health monitor now so the IDE mounts as soon as code-server answers,
		// instead of after every injection plus a full reconcile/health poll cycle.
		triggerReconcile();

		const target = {
			containerId: result.containerId,
			remoteUser: result.remoteUser,
			instance: row
		};
		// Stages parallelize independent injections; per-injection failures are still swallowed
		// so one bad injection can't abort the rest of provisioning.
		const injectionsStart = Date.now();
		for (const stage of resolveInjectionStages(row.mode)) {
			await Promise.all(
				stage.map(async (injection) => {
					try {
						await injection.apply(target, (msg) => appendLog(row.id, msg));
					} catch (err) {
						appendLog(row.id, `⚠ ${injection.label} injection failed: ${(err as Error).message}\n`);
					}
				})
			);
		}
		appendLog(row.id, `⏱ injections: ${elapsed(injectionsStart)}\n`);

		// Unblocks the terminal launcher's wait; written even after ⚠s — its timeout is the fallback.
		await writeContainerFile(target, { dir: '$HOME', name: INJECTIONS_DONE_FILE }, 'done\n').catch(
			() => undefined
		);

		// postStartCommand ran before the injections above, and its launcher bails when the binary
		// is missing — so a container whose build-time ttyd install failed got it too late to be
		// started. No-ops (one accessibility probe) whenever postStart already brought the port up.
		await relaunchSurface(row);

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
		mode: opts.mode ?? getDefaultMode(),
		terminal_split: 0
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
	syncLogCapture(rows);
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

/**
 * Remembers whether the terminal's scratch-shell pane was left open. Deliberately skips
 * `triggerReconcile()` — it's a per-instance UI preference read once at page load, so pushing the
 * whole instance list to every socket on each toggle would be pure noise.
 */
export function setTerminalSplit(id: string, open: boolean): InstanceRow {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	updateInstance(id, { terminal_split: open ? 1 : 0 });
	return getInstance(id)!;
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
	// Forwards publish on PUBLISH_HOST (0.0.0.0 under HOST=0.0.0.0), so forwarding the port the
	// instance is actually served on would republish code-server/ttyd — neither of which has auth
	// of its own — outside the Basic-Auth-gated proxy. Scoped to the live surface on purpose: in
	// terminal mode nothing listens on 8080, and it's far too common an app port to reserve.
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

/** Single-quote a path for the shell, so a workspace folder with spaces survives the `cd`. */
function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * `postStartCommand` is a devcontainer-CLI lifecycle hook, not a container entrypoint, so a plain
 * `docker start` never re-runs it and the ttyd daemon it backgrounded is gone. IDE mode only
 * survives because the code-server feature ships an entrypoint of its own; ttyd has no equivalent.
 * Both launchers are guarded (ttyd by process name, code-server by its port), so re-running one
 * against a healthy container is a no-op.
 */
export async function relaunchSurface(row: InstanceRow): Promise<void> {
	if (!row.container_id) return;

	const steps: string[] = [];
	// The folderOpen task's run-once gate is meant to span one container run, but the marker file
	// outlives it — left in place, a restarted IDE container never reopens the Claude terminal.
	if (row.mode !== 'terminal') steps.push(`rm -f "$HOME/${TERMINAL_LAUNCHED_MARKER}"`);
	// code-server comes back on its own (its feature ships a container entrypoint), so only launch
	// a surface that is actually down rather than racing the entrypoint for the port.
	if (!(await surfaceAccessible(row.host_port))) steps.push(launchCommandFor(row.mode));
	if (!steps.length) return;

	// Both launchers resolve paths off `$PWD`, which under postStartCommand is the workspace
	// folder; an exec only inherits the image's WorkingDir, so re-establish it explicitly.
	const cd = row.remote_workspace_folder
		? `cd ${quote(row.remote_workspace_folder)} || exit 1; `
		: '';
	const res = await execInContainer(
		{ containerId: row.container_id, remoteUser: row.remote_user },
		{ script: cd + steps.join('; ') }
	);
	if (!res.ok) {
		appendLog(row.id, `⚠ Could not relaunch ${surfaceLabel(row.mode)}: ${res.error}\n`);
	}
}

export async function startInstance(id: string): Promise<InstanceRow> {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	if (!row.container_id) throw new Error('Instance has no container yet');
	const ok = await startContainer(row.container_id);
	// Awaited so the first health tick after the reconcile below already sees a listening port.
	if (ok) await relaunchSurface(row);
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
	// Stop capturing but leave <LOGS_DIR>/*-<id>.jsonl on disk — retention outlives the instance.
	stopLogCapture(id);
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
