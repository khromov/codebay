import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, PORT_BASE, PORT_MAX } from '../lib/config.server.ts';
import {
	deleteForwards,
	deleteInstanceRow,
	getInstance,
	insertInstance,
	openRunFor,
	setOption,
	type InstanceRow
} from '../lib/db.server.ts';
import { pollRunNow, runMirrorPath, startRun } from '../lib/agent-runs.server.ts';
import {
	MCP_ENABLED_KEY,
	MCP_PATH,
	getMcpToken,
	mcpAuthOk,
	regenerateMcpToken,
	setMcpEnabled
} from '../lib/mcp-auth.server.ts';
import { mcpRoutes } from './routes.server.ts';

const route = mcpRoutes[MCP_PATH] as { handler: (event: unknown) => Promise<Response> };

/** Mochi hands api handlers a `MochiApiEvent`; only `request` matters to this route. */
function call(init: RequestInit & { token?: string | null } = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('content-type', 'application/json');
	headers.set('accept', 'application/json, text/event-stream');
	if (init.token !== null) headers.set('authorization', `Bearer ${init.token ?? getMcpToken()}`);
	const request = new Request(`http://localhost:6969${MCP_PATH}`, {
		method: init.method ?? 'POST',
		headers,
		body: init.body
	});
	return route.handler({ request, method: request.method, url: new URL(request.url), params: {} });
}

const rpc = (method: string, params: unknown = {}, id: number | string = 1) =>
	JSON.stringify({ jsonrpc: '2.0', id, method, params });

const INITIALIZE = rpc('initialize', {
	protocolVersion: '2025-06-18',
	capabilities: {},
	clientInfo: { name: 'codebay-test', version: '0' }
});

/** The transport answers with an SSE stream; the JSON-RPC payload rides in a `data:` line. */
async function rpcResult(res: Response): Promise<Record<string, unknown>> {
	const body = await res.text();
	const line = body.split('\n').find((l) => l.startsWith('data:'));
	return JSON.parse(line ? line.slice(5).trim() : body) as Record<string, unknown>;
}

afterEach(() => setOption(MCP_ENABLED_KEY, '0'));

describe('the /mcp gate', () => {
	test('is a 404 until someone enables it, so a fresh install exposes nothing', async () => {
		setOption(MCP_ENABLED_KEY, '0');
		expect((await call({ body: INITIALIZE })).status).toBe(404);
	});

	test('401s without a bearer token', async () => {
		setMcpEnabled(true);
		const res = await call({ body: INITIALIZE, token: null });
		expect(res.status).toBe(401);
		expect(res.headers.get('www-authenticate')).toContain('Bearer');
	});

	test('401s on a wrong token', async () => {
		setMcpEnabled(true);
		expect((await call({ body: INITIALIZE, token: 'cb_nope' })).status).toBe(401);
	});

	test('accepts the current token', async () => {
		setMcpEnabled(true);
		expect((await call({ body: INITIALIZE })).ok).toBe(true);
	});

	test('a regenerated token invalidates the old one', async () => {
		setMcpEnabled(true);
		const old = getMcpToken();
		const next = regenerateMcpToken();
		expect(next).not.toBe(old);
		expect((await call({ body: INITIALIZE, token: old })).status).toBe(401);
		expect((await call({ body: INITIALIZE, token: next })).ok).toBe(true);
	});

	test('mcpAuthOk rejects a Basic header, which is a different scheme entirely', () => {
		const request = new Request('http://x/mcp', {
			headers: { authorization: `Basic ${btoa(`admin:${getMcpToken()}`)}` }
		});
		expect(mcpAuthOk(request)).toBe(false);
	});
});

describe('the protocol surface', () => {
	test('completes a JSON-RPC initialize', async () => {
		setMcpEnabled(true);
		const body = await rpcResult(await call({ body: INITIALIZE }));
		const result = body.result as { serverInfo: { name: string }; capabilities: unknown };
		expect(result.serverInfo.name).toBe('codebay');
		expect(result.capabilities).toBeDefined();
	});

	test('advertises the whole sandbox tool surface with usable schemas', async () => {
		setMcpEnabled(true);
		const sessionId = (await call({ body: INITIALIZE })).headers.get('mcp-session-id');
		const headers = sessionId ? { 'mcp-session-id': sessionId } : undefined;
		await call({ body: rpc('notifications/initialized'), headers });

		const body = await rpcResult(await call({ body: rpc('tools/list', {}, 2), headers }));
		const tools = (body.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
		const names = tools.map((t) => t.name).sort();

		expect(names).toEqual(
			[
				'add_port_forward',
				'create_pr',
				'create_sandbox',
				'delete_sandbox',
				'exec_command',
				'get_diff',
				'get_logs',
				'get_run',
				'get_sandbox',
				'git_push',
				'list_runs',
				'list_sandboxes',
				'read_file',
				'rebuild_sandbox',
				'remove_port_forward',
				'rename_sandbox',
				'run_agent',
				'start_sandbox',
				'stop_run',
				'stop_sandbox',
				'write_file'
			].sort()
		);

		// The valibot adapter has to produce real JSON Schema, or a client can't call anything.
		const runAgent = tools.find((t) => t.name === 'run_agent')!;
		expect(runAgent.inputSchema).toMatchObject({
			type: 'object',
			properties: {
				sandbox_id: { type: 'string' },
				prompt: { type: 'string' },
				model: { type: 'string' }
			},
			required: ['sandbox_id', 'prompt']
		});
	});

	test('reports a bad sandbox id as a tool error rather than crashing the session', async () => {
		setMcpEnabled(true);
		const sessionId = (await call({ body: INITIALIZE })).headers.get('mcp-session-id');
		const headers = sessionId ? { 'mcp-session-id': sessionId } : undefined;
		await call({ body: rpc('notifications/initialized'), headers });

		const body = await rpcResult(
			await call({
				body: rpc('tools/call', { name: 'get_sandbox', arguments: { sandbox_id: 'nope' } }, 3),
				headers
			})
		);
		expect(JSON.stringify(body)).toContain('No sandbox with id nope');
	});
});

/** Initialize + initialized, the handshake every tools/call needs; returns the session headers. */
async function session(): Promise<Record<string, string> | undefined> {
	setMcpEnabled(true);
	const sessionId = (await call({ body: INITIALIZE })).headers.get('mcp-session-id');
	const headers = sessionId ? { 'mcp-session-id': sessionId } : undefined;
	await call({ body: rpc('notifications/initialized'), headers });
	return headers;
}

/** The slice of the lifecycle tools' payloads these tests look at. */
interface ToolPayload {
	sandbox?: {
		name: string;
		status: string;
		error: string | null;
		forwarded_ports: { container_port: number; host_port: number; open: boolean }[];
	};
	cancelled_run?: { run_id: string; status: string; error: string | null } | null;
	forward?: { container_port: number; host_port: number; open: boolean } | null;
	note?: string;
	log?: string;
}

let rpcSeq = 10;
/** A tools/call through the transport, unwrapped to the JSON the tool returned (or its error text). */
async function callTool(
	headers: Record<string, string> | undefined,
	name: string,
	args: Record<string, unknown>
): Promise<{ error: string | null; payload: ToolPayload }> {
	const body = await rpcResult(
		await call({ body: rpc('tools/call', { name, arguments: args }, ++rpcSeq), headers })
	);
	const result = body.result as { content: { text: string }[]; isError?: boolean };
	const text = result.content.map((c) => c.text).join('');
	return result.isError
		? { error: text, payload: {} }
		: { error: null, payload: JSON.parse(text) as ToolPayload };
}

/**
 * The same seam the lifecycle tests use: `getDocker()` resolves whatever sits in the pinned slot, so
 * start/stop/exec run against this stub and no daemon is involved.
 */
const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };

function fakeDocker(opts: { startFails?: boolean } = {}) {
	const calls = { started: 0, stopped: 0, scripts: [] as string[] };
	const container = {
		start: async () => {
			calls.started++;
			if (opts.startFails) throw Object.assign(new Error('http 500'), { statusCode: 500 });
		},
		stop: async () => {
			calls.stopped++;
		},
		remove: async () => undefined,
		// Reported as stopped so the reconcile that follows never spins up a health monitor.
		inspect: async () => ({ State: { Running: false } }),
		exec: async (cfg: { Cmd: string[] }) => {
			calls.scripts.push(cfg.Cmd[2]!);
			return {
				start: async () => {
					const s = new PassThrough();
					queueMicrotask(() => s.end());
					return s;
				},
				modem: {
					demuxStream: (s: PassThrough, out: NodeJS.WritableStream) => {
						s.on('data', (c) => out.write(c));
						s.resume();
					}
				},
				inspect: async () => ({ ExitCode: 0 })
			};
		}
	};
	g.__codebayDocker = Promise.resolve({
		getContainer: () => container,
		listContainers: async () => []
	});
	return calls;
}

const realFetch = globalThis.fetch;
/** `startInstance` probes the surface before relaunching it; a refused connection means "down". */
function stubSurfaceDown() {
	globalThis.fetch = (async () => {
		throw new Error('ECONNREFUSED');
	}) as unknown as typeof fetch;
}

let seq = 0;
const seeded: string[] = [];
function seed(overrides: Partial<InstanceRow> = {}): InstanceRow {
	const row: InstanceRow = {
		id: `mcp-inst-${++seq}`,
		name: `mcp-inst-${seq}`,
		source_path: '/src',
		workspace_path: '/ws',
		host_port: 8900 + seq,
		container_id: 'container-mcp',
		remote_workspace_folder: '/workspace',
		status: 'running',
		error: null,
		created_at: Date.now(),
		bridge_token: 'tok',
		remote_user: 'node',
		image_source: 'local',
		avatar: null,
		mode: 'terminal',
		terminal_split: 0,
		config_migrated: 1,
		...overrides
	};
	insertInstance(row);
	seeded.push(row.id);
	return row;
}

/** Polls a fire-and-forget effect instead of racing it on a fixed sleep. */
async function until(done: () => boolean, tries = 400): Promise<void> {
	for (let i = 0; i < tries && !done(); i++) await Bun.sleep(5);
	expect(done()).toBe(true);
}

describe('the sandbox lifecycle tools', () => {
	beforeEach(() => stubSurfaceDown());
	afterEach(() => {
		globalThis.fetch = realFetch;
		g.__codebayDocker = undefined;
		for (const id of seeded.splice(0)) {
			deleteForwards(id);
			deleteInstanceRow(id);
		}
	});

	test('stop_sandbox stops the container and hands back the stopped sandbox', async () => {
		const calls = fakeDocker();
		const row = seed();
		const { error, payload } = await callTool(await session(), 'stop_sandbox', {
			sandbox_id: row.id
		});
		expect(error).toBeNull();
		expect(calls.stopped).toBe(1);
		expect(payload.sandbox?.status).toBe('stopped');
		expect(payload.cancelled_run).toBeNull();
		// The workspace row survives: this is what distinguishes it from delete_sandbox.
		expect(getInstance(row.id)?.status).toBe('stopped');
	});

	test('stop_sandbox cancels an active run and reports it, mirroring the dashboard’s Stop', async () => {
		fakeDocker();
		const row = seed();
		const run = startRun(row, 'go');
		await pollRunNow(run.id);

		const { error, payload } = await callTool(await session(), 'stop_sandbox', {
			sandbox_id: row.id
		});
		expect(error).toBeNull();
		expect(payload.sandbox?.status).toBe('stopped');
		expect(payload.cancelled_run?.run_id).toBe(run.id);
		expect(payload.cancelled_run?.status).toBe('cancelled');
		expect(payload.cancelled_run?.error).toBe('the sandbox was stopped');
		expect(openRunFor(row.id)).toBeNull();
		rmSync(runMirrorPath(run.id), { force: true });
	});

	test('stop_sandbox refuses a sandbox that is still building', async () => {
		fakeDocker();
		const row = seed({ status: 'creating' });
		const { error } = await callTool(await session(), 'stop_sandbox', { sandbox_id: row.id });
		expect(error).toContain('still building');
	});

	test('stop_sandbox refuses a sandbox that never got a container', async () => {
		fakeDocker();
		const row = seed({ status: 'error', container_id: null });
		const { error } = await callTool(await session(), 'stop_sandbox', { sandbox_id: row.id });
		expect(error).toContain('no container');
	});

	test('start_sandbox starts the container, relaunches the surface and is already running', async () => {
		const calls = fakeDocker();
		const row = seed({ status: 'stopped' });
		const { error, payload } = await callTool(await session(), 'start_sandbox', {
			sandbox_id: row.id
		});
		expect(error).toBeNull();
		expect(calls.started).toBe(1);
		// Synchronous, unlike create_sandbox: the description promises the status is final on return.
		expect(payload.sandbox?.status).toBe('running');
		expect(calls.scripts.some((s) => s.includes('ttyd --port'))).toBe(true);
	});

	test('start_sandbox reports a container Docker refused to start as an error status', async () => {
		fakeDocker({ startFails: true });
		const row = seed({ status: 'stopped' });
		const { error, payload } = await callTool(await session(), 'start_sandbox', {
			sandbox_id: row.id
		});
		expect(error).toBeNull();
		expect(payload.sandbox?.status).toBe('error');
		expect(payload.sandbox?.error).toContain('Failed to start');
	});

	test('start_sandbox refuses a sandbox that is still building or has no container', async () => {
		fakeDocker();
		const headers = await session();
		const building = seed({ status: 'creating' });
		expect((await callTool(headers, 'start_sandbox', { sandbox_id: building.id })).error).toContain(
			'still building'
		);
		const bare = seed({ status: 'error', container_id: null });
		expect((await callTool(headers, 'start_sandbox', { sandbox_id: bare.id })).error).toContain(
			'no container'
		);
	});

	test('rebuild_sandbox flips the sandbox to creating and builds in the background', async () => {
		fakeDocker();
		// A file where the workspace should be makes the background provision fail fast, so the
		// test can wait for it to settle instead of leaking a boot into the next test.
		const workspace = join(DATA_DIR, 'mcp-rebuild-workspace');
		writeFileSync(workspace, '');
		const row = seed({ status: 'stopped', workspace_path: workspace });

		const headers = await session();
		const { error, payload } = await callTool(headers, 'rebuild_sandbox', {
			sandbox_id: row.id,
			no_cache: true
		});
		expect(error).toBeNull();
		expect(payload.sandbox?.status).toBe('creating');
		expect(payload.note).toContain('Poll get_sandbox');

		await until(() => getInstance(row.id)?.status === 'error');
		const log = await callTool(headers, 'get_logs', { sandbox_id: row.id, kind: 'boot' });
		expect(log.payload.log).toContain('Rebuilding without cache');
		rmSync(workspace, { force: true });
	});

	test('rebuild_sandbox refuses a sandbox whose boot is still in flight', async () => {
		fakeDocker();
		const row = seed({ status: 'creating' });
		const { error } = await callTool(await session(), 'rebuild_sandbox', { sandbox_id: row.id });
		expect(error).toContain('still building');
	});

	test('rename_sandbox applies the name, de-duplicating against other sandboxes', async () => {
		fakeDocker();
		const headers = await session();
		const other = seed({ name: 'taken' });
		const row = seed();

		const renamed = await callTool(headers, 'rename_sandbox', {
			sandbox_id: row.id,
			name: 'fresh'
		});
		expect(renamed.payload.sandbox?.name).toBe('fresh');

		const clash = await callTool(headers, 'rename_sandbox', {
			sandbox_id: row.id,
			name: other.name
		});
		expect(clash.payload.sandbox?.name).toBe('taken #2');

		const blank = await callTool(headers, 'rename_sandbox', { sandbox_id: row.id, name: '  ' });
		expect(blank.error).toContain('empty');
	});

	test('add_port_forward persists a mapping that get_sandbox and remove_port_forward see', async () => {
		fakeDocker();
		const headers = await session();
		const row = seed();

		const added = await callTool(headers, 'add_port_forward', { sandbox_id: row.id, port: 3000 });
		expect(added.error).toBeNull();
		expect(added.payload.forward?.container_port).toBe(3000);
		expect(added.payload.forward?.host_port).toBeGreaterThanOrEqual(PORT_BASE);
		expect(added.payload.forward?.host_port).toBeLessThanOrEqual(PORT_MAX);
		// Nothing is published until a rebuild, and the tool says so rather than implying a live port.
		expect(added.payload.forward?.open).toBe(false);
		expect(added.payload.note).toContain('rebuild_sandbox');

		const detail = await callTool(headers, 'get_sandbox', { sandbox_id: row.id });
		expect(detail.payload.sandbox?.forwarded_ports.map((f) => f.container_port)).toEqual([3000]);

		const dup = await callTool(headers, 'add_port_forward', { sandbox_id: row.id, port: 3000 });
		expect(dup.error).toContain('already forwarded');
		// The terminal surface has no auth of its own, so its port must stay behind the proxy.
		const reserved = await callTool(headers, 'add_port_forward', {
			sandbox_id: row.id,
			port: 7681
		});
		expect(reserved.error).toContain('reserved');

		const removed = await callTool(headers, 'remove_port_forward', {
			sandbox_id: row.id,
			port: 3000
		});
		expect(removed.error).toBeNull();
		expect(removed.payload.sandbox?.forwarded_ports).toEqual([]);
	});
});
