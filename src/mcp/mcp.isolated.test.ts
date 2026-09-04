import { afterEach, describe, expect, test } from 'bun:test';
import { setOption } from '../lib/db.server.ts';
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
				'run_agent',
				'stop_run',
				'write_file'
			].sort()
		);

		// The valibot adapter has to produce real JSON Schema, or a client can't call anything.
		const runAgent = tools.find((t) => t.name === 'run_agent')!;
		expect(runAgent.inputSchema).toMatchObject({
			type: 'object',
			properties: { sandbox_id: { type: 'string' }, prompt: { type: 'string' } },
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
