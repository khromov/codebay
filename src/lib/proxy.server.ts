import { Mochi, type MochiApiEvent, type MochiRouteValue, type MochiWsData } from 'mochi-framework';
import type { ServerWebSocket } from 'bun';
import { getInstance } from './db.server.ts';

export const PROXY_PREFIX = '/p';

/** Internal sentinel, never hit directly: proxied upgrades tag themselves with it so
 * Mochi's shared websocket dispatcher routes them to the relay below. */
const PROXY_WS_PATTERN = '/__codebay_proxy_ws';

export function proxyPathFor(id: string): string {
	return `${PROXY_PREFIX}/${id}/`;
}

/** Null unless the instance is running, since a stopped container publishes nothing. */
function upstreamPort(id: string): number | null {
	const row = getInstance(id);
	if (!row || row.status !== 'running') return null;
	return row.host_port;
}

/** Bun's wildcard routes expose `:id` but not the `*` capture, so strip the prefix by hand. */
function restOf(pathname: string, id: string): string {
	return pathname.slice(`${PROXY_PREFIX}/${id}`.length) || '/';
}

type Frame = string | Buffer;

/** The cast gets past the DOM `send` overload's strict typing. */
function sendFrame(socket: { send: (data: never) => unknown }, frame: Frame): void {
	socket.send(frame as never);
}

/** Only 1000 and 3000–4999 may be passed to `.close()`; anything else throws. */
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

interface RelayState {
	upstreamWsUrl: string;
	client?: WebSocket;
	/** Frames received from the browser before the upstream socket is open. */
	pending: Frame[];
	/** Frames the upstream sent before the browser socket existed (connect-first path only). */
	inbound?: Frame[];
	/** The client's requested subprotocols, forwarded upstream — ttyd requires its `tty` one. */
	subprotocols?: string[];
}

/** Opens the upstream socket and buffers anything it emits until the browser socket is wired up. */
function connectUpstream(
	url: string,
	subprotocols: string[]
): Promise<{ client: WebSocket; inbound: Frame[] }> {
	return new Promise((resolve, reject) => {
		const client = new WebSocket(url, subprotocols);
		client.binaryType = 'arraybuffer';
		const inbound: Frame[] = [];
		client.onmessage = (e) => inbound.push(e.data as Frame);
		client.onopen = () => resolve({ client, inbound });
		client.onerror = () => reject(new Error('upstream websocket error'));
	});
}

async function proxyHttp(event: MochiApiEvent, port: number, rest: string): Promise<Response> {
	const headers = new Headers(event.request.headers);
	headers.set('host', `127.0.0.1:${port}`);
	headers.delete('accept-encoding'); // ask for an unencoded body so we can stream it verbatim
	// code-server runs with `--auth none`, so forwarding this would only leak the app password.
	// `cookie` is deliberately kept: the manager's only same-origin cookie is the UI theme, so
	// anything else here belongs to the upstream and has to survive the round trip.
	headers.delete('authorization');
	const hasBody = event.method !== 'GET' && event.method !== 'HEAD';
	let upstream: Response;
	try {
		upstream = await fetch(`http://127.0.0.1:${port}${rest}${event.url.search}`, {
			method: event.method,
			headers,
			body: hasBody ? event.request.body : undefined,
			redirect: 'manual',
			// @ts-expect-error Bun streams request bodies with duplex: 'half'.
			duplex: 'half'
		});
	} catch (err) {
		// Usually just code-server not having bound its port yet; letting it escape would
		// render a 500 stack trace inside the IDE iframe.
		console.warn(`[proxy] upstream 127.0.0.1:${port}${rest} unreachable:`, (err as Error).message);
		return new Response('code-server is not accepting connections yet', {
			status: 503,
			headers: { 'retry-after': '1', 'cache-control': 'no-store' }
		});
	}

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

async function proxyUpgrade(event: MochiApiEvent, port: number, rest: string): Promise<Response> {
	const requested = event.request.headers.get('sec-websocket-protocol');
	const subprotocols = requested
		? requested
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: undefined;
	const upstreamWsUrl = `ws://127.0.0.1:${port}${rest}${event.url.search}`;

	const state: RelayState = { upstreamWsUrl, pending: [], subprotocols };
	let selected: string | undefined;

	// When subprotocols are in play, open the upstream first so the 101 echoes the one it actually
	// negotiated instead of guessing its first offer — a mismatch would leave the browser and
	// upstream disagreeing on the protocol. code-server offers none and connects lazily in open().
	if (subprotocols) {
		try {
			const { client, inbound } = await connectUpstream(upstreamWsUrl, subprotocols);
			state.client = client;
			state.inbound = inbound;
			selected = client.protocol || undefined;
		} catch {
			return new Response('Upstream WebSocket unreachable', { status: 502 });
		}
	}

	const data: MochiWsData<RelayState> = {
		__mochiRoutePattern: PROXY_WS_PATTERN,
		__mochiOpenedAt: performance.now(),
		__mochiPath: event.url.pathname,
		user: state
	};
	const headers = selected ? { 'Sec-WebSocket-Protocol': selected } : undefined;
	// Bun's Server is typed with a fixed WebSocketData; Mochi casts the same way for its own upgrades.
	const ok = (
		event.server as unknown as {
			upgrade: (
				req: Request,
				opts: { data: MochiWsData<RelayState>; headers?: Record<string, string> }
			) => boolean;
		}
	).upgrade(event.request, { data, headers });
	if (!ok) {
		if (state.client) safeClose(state.client, 1000, ''); // don't orphan the pre-opened upstream
		return new Response('WebSocket upgrade failed', { status: 426 });
	}
	// Bun already sent the real 101; this is ignored, but Mochi's resolve chain reads a status.
	return new Response(null, { status: 101 });
}

/** Ordinary routes, so the global Basic Auth handle wraps them — WS upgrades included. */
export const proxyRoutes: Record<string, MochiRouteValue> = {
	// code-server emits relative URLs, so the mount has to end in a slash.
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

		// An upgrade is a GET carrying `Upgrade: websocket`, so Bun routes it here too.
		if (event.request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			return await proxyUpgrade(event, port, rest);
		}
		return proxyHttp(event, port, rest);
	}),

	// `upgrade: () => false` rejects anyone who navigates to the sentinel directly.
	[PROXY_WS_PATTERN]: Mochi.ws<RelayState>({
		upgrade: () => false,
		open(ws: ServerWebSocket<MochiWsData<RelayState>>) {
			const state = ws.data.user;
			// Pre-opened during the handshake when a subprotocol was negotiated; otherwise connect now.
			const client =
				state.client ??
				(state.subprotocols
					? new WebSocket(state.upstreamWsUrl, state.subprotocols)
					: new WebSocket(state.upstreamWsUrl));
			client.binaryType = 'arraybuffer';
			state.client = client;

			// Drain whatever the upstream sent before this socket existed (connect-first path only).
			if (state.inbound) {
				for (const frame of state.inbound) {
					try {
						ws.send(frame as never);
					} catch {
						/* browser socket closed */
					}
				}
				state.inbound = undefined;
			}

			client.onmessage = (e) => {
				try {
					ws.send(e.data);
				} catch {
					/* browser socket closed */
				}
			};
			client.onclose = (e) => safeClose(ws, e.code, e.reason);
			client.onerror = () => safeClose(ws, 1011, 'upstream error');

			// A pre-opened socket already fired `onopen`, so flush now; a lazy one flushes on open.
			if (client.readyState === WebSocket.OPEN) {
				for (const frame of state.pending) sendFrame(client, frame);
				state.pending = [];
			} else {
				client.onopen = () => {
					for (const frame of state.pending) sendFrame(client, frame);
					state.pending = [];
				};
			}
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
