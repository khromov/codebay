import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { MochiEvent, MochiResolveFn } from 'mochi-framework';
import * as config from './config.server.ts';
import { basicAuth, wsUpgradeAllowed } from './auth.server.ts';
import { PROXY_PREFIX, proxyRoutes } from './proxy.server.ts';

const HOST = 'codebay.test';
const ORIGIN = `http://${HOST}`;
const PASSWORD = 'hunter2';

/**
 * `BASIC_AUTH_PASSWORD` is a module const, so each block pins the value it needs rather than
 * inheriting whatever the developer happens to have exported. Snapshotted before any mocking
 * so the override never compounds; `auth.server.ts` reads it through a live binding, which is
 * why re-mocking works on the already-imported module above.
 */
const realConfig = { ...config };
function setPassword(password: string): void {
	mock.module('./config.server.ts', () => ({ ...realConfig, BASIC_AUTH_PASSWORD: password }));
}

interface ReqOpts {
	method?: string;
	/** Omitted means no `Origin` header at all — i.e. a non-browser client. */
	origin?: string;
	/** Omitted means no `Authorization` header. */
	password?: string;
	username?: string;
	upgrade?: boolean;
	csrf?: boolean;
}

function request(path: string, o: ReqOpts = {}): Request {
	const headers = new Headers({ host: HOST });
	if (o.origin !== undefined) headers.set('origin', o.origin);
	if (o.password !== undefined) {
		headers.set('authorization', `Basic ${btoa(`${o.username ?? 'admin'}:${o.password}`)}`);
	}
	if (o.upgrade) {
		headers.set('upgrade', 'websocket');
		headers.set('connection', 'Upgrade');
	}
	if (o.csrf) headers.set('x-codebay-request', '1');
	return new Request(`http://${HOST}${path}`, { method: o.method ?? 'GET', headers });
}

/** `resolved` is the assertion that matters: a rejected request must never reach the route. */
async function run(req: Request): Promise<{ status: number; resolved: boolean; res: Response }> {
	let resolved = false;
	const resolve: MochiResolveFn = async () => {
		resolved = true;
		return new Response('reached the route');
	};
	const event = {
		request: req,
		url: new URL(req.url),
		locals: {},
		kind: 'api',
		isWarmup: false,
		server: undefined as never
	} as MochiEvent;
	const res = await basicAuth({ event, resolve });
	return { status: res.status, resolved, res };
}

// Terminal-mode instances reach ttyd over `/p/:id/ws`, the same proxy route the IDE uses for
// code-server. Neither has auth of its own, so this gate is the only thing in front of a
// writable shell — hence the "never reached the route" assertion on every rejection.
const TERMINAL_WS = `${PROXY_PREFIX}/term1/ws`;
const PROXY_HTTP = `${PROXY_PREFIX}/term1/`;

afterAll(() => setPassword(realConfig.BASIC_AUTH_PASSWORD));

describe('auth gate with no password (the local-dev default)', () => {
	beforeAll(() => setPassword(''));

	test('accepts a same-origin WebSocket upgrade', () => {
		expect(wsUpgradeAllowed(request(TERMINAL_WS, { origin: ORIGIN, upgrade: true }))).toBe(true);
	});

	test('rejects cross-site WebSocket hijacking even with no password set', () => {
		expect(
			wsUpgradeAllowed(request(TERMINAL_WS, { origin: 'https://evil.com', upgrade: true }))
		).toBe(false);
	});

	test('rejects an opaque `Origin: null` (sandboxed iframe)', () => {
		expect(wsUpgradeAllowed(request(TERMINAL_WS, { origin: 'null', upgrade: true }))).toBe(false);
	});

	test('rejects an origin that merely has the host as a prefix', () => {
		expect(
			wsUpgradeAllowed(request(TERMINAL_WS, { origin: `http://${HOST}.evil.com`, upgrade: true }))
		).toBe(false);
	});

	test('rejects the same host on a different port', () => {
		expect(
			wsUpgradeAllowed(request(TERMINAL_WS, { origin: `http://${HOST}:1234`, upgrade: true }))
		).toBe(false);
	});

	test('allows a missing Origin, which is how non-browser clients present', () => {
		expect(wsUpgradeAllowed(request(TERMINAL_WS, { upgrade: true }))).toBe(true);
	});

	test('handle rejects a cross-origin upgrade before it reaches the proxy', async () => {
		const { status, resolved } = await run(
			request(TERMINAL_WS, { origin: 'https://evil.com', upgrade: true })
		);
		expect(status).toBe(403);
		expect(resolved).toBe(false);
	});

	test('handle passes a same-origin upgrade through', async () => {
		const { resolved } = await run(request(TERMINAL_WS, { origin: ORIGIN, upgrade: true }));
		expect(resolved).toBe(true);
	});

	test('mutating /api/ call without the CSRF header is refused', async () => {
		const { status, resolved } = await run(
			request('/api/instances/term1/split', { method: 'POST', origin: ORIGIN })
		);
		expect(status).toBe(403);
		expect(resolved).toBe(false);
	});

	test('mutating /api/ call with the CSRF header is allowed', async () => {
		const { resolved } = await run(
			request('/api/instances/term1/split', { method: 'POST', origin: ORIGIN, csrf: true })
		);
		expect(resolved).toBe(true);
	});

	test('the container bridge is exempt from the CSRF header', async () => {
		const { resolved } = await run(request('/api/bridge/attention', { method: 'POST' }));
		expect(resolved).toBe(true);
	});
});

describe('auth gate with a password set', () => {
	beforeAll(() => setPassword(PASSWORD));

	test('proxied HTTP without credentials is challenged', async () => {
		const { status, resolved, res } = await run(request(PROXY_HTTP, { origin: ORIGIN }));
		expect(status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
		expect(resolved).toBe(false);
	});

	test('a wrong password is refused', async () => {
		const { status, resolved } = await run(
			request(PROXY_HTTP, { origin: ORIGIN, password: 'wrong' })
		);
		expect(status).toBe(401);
		expect(resolved).toBe(false);
	});

	test('a wrong username is refused even with the right password', async () => {
		const { status, resolved } = await run(
			request(PROXY_HTTP, { origin: ORIGIN, username: 'root', password: PASSWORD })
		);
		expect(status).toBe(401);
		expect(resolved).toBe(false);
	});

	test('correct credentials pass through', async () => {
		const { resolved } = await run(request(PROXY_HTTP, { origin: ORIGIN, password: PASSWORD }));
		expect(resolved).toBe(true);
	});

	test('the terminal WebSocket without credentials never reaches the proxy', async () => {
		const { status, resolved } = await run(request(TERMINAL_WS, { origin: ORIGIN, upgrade: true }));
		expect(status).toBe(401);
		expect(resolved).toBe(false);
	});

	test('the terminal WebSocket with credentials but a foreign origin is refused', async () => {
		const { status, resolved } = await run(
			request(TERMINAL_WS, { origin: 'https://evil.com', upgrade: true, password: PASSWORD })
		);
		expect(status).toBe(403);
		expect(resolved).toBe(false);
	});

	test('the terminal WebSocket with correct same-origin credentials is allowed', async () => {
		const { resolved } = await run(
			request(TERMINAL_WS, { origin: ORIGIN, upgrade: true, password: PASSWORD })
		);
		expect(resolved).toBe(true);
	});

	test('wsUpgradeAllowed requires credentials once a password is set', () => {
		expect(wsUpgradeAllowed(request('/api/stream', { origin: ORIGIN, upgrade: true }))).toBe(false);
		expect(
			wsUpgradeAllowed(request('/api/stream', { origin: ORIGIN, upgrade: true, password: 'wrong' }))
		).toBe(false);
		expect(
			wsUpgradeAllowed(
				request('/api/stream', { origin: ORIGIN, upgrade: true, password: PASSWORD })
			)
		).toBe(true);
	});

	test('the container bridge stays reachable without the app password', async () => {
		const { resolved } = await run(request('/api/bridge/attention', { method: 'POST' }));
		expect(resolved).toBe(true);
	});
});

describe('proxy route wiring', () => {
	// `Mochi.ws` routes are dispatched by Bun directly and never reach the handle chain. Moving
	// the proxy onto one would silently unauthenticate every instance, terminal and IDE alike.
	test('the proxy wildcard is a handle-wrapped route, not a Mochi.ws route', () => {
		const route = proxyRoutes[`${PROXY_PREFIX}/:id/*`];
		expect(route).toBeDefined();
		expect(route).not.toHaveProperty('__mochiWs');
	});
});
