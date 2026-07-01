import { Mochi, type MochiApiEvent, type MochiRouteValue, type MochiWsData } from 'mochi-framework';
import type { ServerWebSocket } from 'bun';
import { getInstance } from './db.server.ts';

/** URL prefix under which every instance's code-server is proxied. */
export const PROXY_PREFIX = '/p';

/**
 * Route key for the WebSocket relay. The `/p/:id/*` handler initiates upgrades
 * with `data.__mochiRoutePattern` set to this value, so Mochi's shared websocket
 * dispatcher routes their open/message/close to the relay registered here. The
 * two must match. Clients never hit this path directly.
 */
const PROXY_WS_PATTERN = '/__dcm_proxy_ws';

/** Same-origin path that loads an instance's IDE through the proxy. */
export function proxyPathFor(id: string): string {
	return `${PROXY_PREFIX}/${id}/`;
}

/** Loopback origin of a running instance's published code-server port, or null. */
function upstreamPort(id: string): number | null {
	const row = getInstance(id);
	if (!row || row.status !== 'running') return null;
	return row.host_port;
}

/**
 * Path to forward upstream — everything after the `/p/<id>` mount. Bun's
 * wildcard routes expose `:id` but not the `*` capture, so we strip the prefix
 * from the pathname ourselves. '/p/abc/static/x.js' → '/static/x.js'.
 */
function restOf(pathname: string, id: string): string {
	return pathname.slice(`${PROXY_PREFIX}/${id}`.length) || '/';
}

/** A WebSocket frame in either direction — text or a binary buffer. */
type Frame = string | Buffer;

/** Forward a relayed frame, casting past the DOM `send` overload's strict typing. */
function sendFrame(socket: { send: (data: never) => unknown }, frame: Frame): void {
	socket.send(frame as never);
}

/** Close codes an application is allowed to pass to `.close()`; others throw. */
function safeClose(
	ws: { close: (code?: number, reason?: string) => void },
	code: number,
	reason: string
): void {
	try {
		if (code === 1000 || (code >= 3000 && code <= 4999)) ws.close(code, reason);
		else ws.close();
	} catch {
		/* already closed */
	}
}

/** Relay state carried on each proxied WebSocket (the `user` slot of MochiWsData). */
interface RelayState {
	upstreamWsUrl: string;
	client?: WebSocket;
	/** Frames received from the browser before the upstream socket is open. */
	pending: Frame[];
}

/** Stream a plain HTTP request through to the upstream, applying proxy header hygiene. */
async function proxyHttp(event: MochiApiEvent, port: number, rest: string): Promise<Response> {
	const headers = new Headers(event.request.headers);
	headers.set('host', `127.0.0.1:${port}`);
	headers.delete('accept-encoding'); // ask for an unencoded body so we can stream it verbatim
	// Defense-in-depth: don't forward the manager's own Basic Auth credentials to
	// the upstream code-server. It runs with `--auth none`, so the header is
	// meaningless to it and would only risk leaking the app password into editor
	// land. We deliberately do NOT strip `cookie`: the manager sets no cookies of
	// its own (it authenticates via the Authorization header), so every cookie on
	// a same-origin `/p/:id/*` request is code-server's own — dropping it would
	// break any editor feature that round-trips a cookie.
	headers.delete('authorization');
	const hasBody = event.method !== 'GET' && event.method !== 'HEAD';
	const upstream = await fetch(`http://127.0.0.1:${port}${rest}${event.url.search}`, {
		method: event.method,
		headers,
		body: hasBody ? event.request.body : undefined,
		redirect: 'manual',
		// @ts-expect-error Bun streams request bodies with duplex: 'half'.
		duplex: 'half'
	});

	const resHeaders = new Headers(upstream.headers);
	resHeaders.delete('content-encoding'); // body is already decoded by fetch
	resHeaders.delete('transfer-encoding'); // Bun re-frames the streamed body
	resHeaders.delete('content-length'); // may not match after re-framing; let Bun set it
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: resHeaders
	});
}

/** Upgrade a proxied WebSocket, tagging it so Mochi dispatches it to the relay below. */
function proxyUpgrade(event: MochiApiEvent, port: number, rest: string): Response {
	const data: MochiWsData<RelayState> = {
		__mochiRoutePattern: PROXY_WS_PATTERN,
		__mochiOpenedAt: performance.now(),
		__mochiPath: event.url.pathname,
		user: { upstreamWsUrl: `ws://127.0.0.1:${port}${rest}${event.url.search}`, pending: [] }
	};
	// Bun's Server is typed with a fixed WebSocketData; cast to hand it our
	// relay-tagged data, matching how Mochi performs its own upgrades.
	const ok = (
		event.server as unknown as {
			upgrade: (req: Request, opts: { data: MochiWsData<RelayState> }) => boolean;
		}
	).upgrade(event.request, { data });
	if (!ok) return new Response('WebSocket upgrade failed', { status: 426 });
	// The 101 was already sent by Bun; this sentinel is ignored but keeps the
	// Mochi resolve chain (which reads `response.status`) happy.
	return new Response(null, { status: 101 });
}

/**
 * The reverse proxy as three route entries, spread into the route table:
 *  - `/p/:id`    → 308 to `/p/:id/` (code-server emits relative URLs, so the
 *                  mount must end in a slash; the wildcard below won't match the
 *                  bare form).
 *  - `/p/:id/*`  → all HTTP under the mount, and the initiation of WS upgrades.
 *  - sentinel ws → parks the relay handlers in Mochi's websocket dispatcher.
 *
 * All three resolve as ordinary routes, so the global `handle` middleware
 * (Basic Auth) wraps them — including WS upgrades, which are ordinary GETs.
 */
export const proxyRoutes: Record<string, MochiRouteValue> = {
	[`${PROXY_PREFIX}/:id`]: Mochi.api(({ url }) => {
		return new Response(null, {
			status: 308,
			headers: { Location: `${url.pathname}/${url.search}` }
		});
	}),

	[`${PROXY_PREFIX}/:id/*`]: Mochi.api(async (event) => {
		const port = upstreamPort(event.params.id!);
		if (port === null) return new Response('Instance not running', { status: 502 });

		const rest = restOf(event.url.pathname, event.params.id!);

		// A WebSocket upgrade is an HTTP GET carrying `Upgrade: websocket`, so Bun
		// routes it here too. Hand it off to Bun + the relay handlers.
		if (event.request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			return proxyUpgrade(event, port, rest);
		}
		return proxyHttp(event, port, rest);
	}),

	// Relay handlers, dispatched by Mochi for sockets tagged with PROXY_WS_PATTERN.
	// `upgrade: () => false` rejects anyone who navigates to the sentinel directly.
	[PROXY_WS_PATTERN]: Mochi.ws<RelayState>({
		upgrade: () => false,
		open(ws: ServerWebSocket<MochiWsData<RelayState>>) {
			const state = ws.data.user;
			const client = new WebSocket(state.upstreamWsUrl);
			client.binaryType = 'arraybuffer';
			state.client = client;

			client.onopen = () => {
				for (const frame of state.pending) sendFrame(client, frame);
				state.pending = [];
			};
			client.onmessage = (e) => {
				try {
					ws.send(e.data);
				} catch {
					/* browser socket closed */
				}
			};
			client.onclose = (e) => safeClose(ws, e.code, e.reason);
			client.onerror = () => safeClose(ws, 1011, 'upstream error');
		},
		message(ws: ServerWebSocket<MochiWsData<RelayState>>, message) {
			const state = ws.data.user;
			if (state.client && state.client.readyState === WebSocket.OPEN)
				sendFrame(state.client, message);
			else state.pending.push(message);
		},
		close(ws: ServerWebSocket<MochiWsData<RelayState>>) {
			// `client` is always set in open() before any close is relayed.
			const client = ws.data.user.client;
			if (client) safeClose(client, 1000, '');
		}
	})
};
