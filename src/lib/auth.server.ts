import type { Handle } from 'mochi-framework';
import { BASIC_AUTH_PASSWORD, BASIC_AUTH_USERNAME } from './config.server.ts';
import { timingSafeEqualStr } from './crypto.server.ts';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']);

interface PeerResolver {
	requestIP(req: Request): { address: string } | null;
}

/**
 * `Mochi.ws` upgrade callbacks receive only (req, params), so the peer address has to come from
 * the server handle stashed here. Pinned to `globalThis` and re-captured from every HTTP request
 * because dev-mode hot reload re-evaluates this module but never re-runs `src/index.ts` — a
 * boot-only assignment would silently go null and make the gate refuse everyone.
 */
const globalForServer = globalThis as unknown as { __codebayServer?: PeerResolver | null };

export function setServer(next: PeerResolver | null): void {
	globalForServer.__codebayServer = next;
}

export function isLoopbackPeer(req: Request): boolean {
	const address = globalForServer.__codebayServer?.requestIP(req)?.address;
	// Unknown peer is treated as remote — the safe direction for a gate in front of a host shell.
	return address !== undefined && address !== null && LOOPBACK_ADDRESSES.has(address);
}

/**
 * Sandbox mode's terminal is a shell on the *host*, not in a container — nono constrains what it
 * may touch, but has nothing to say about who gets to type into it. So it needs a boundary the
 * container modes don't: either a password, or a peer that is this machine.
 *
 * Keyed on the **peer**, not the bind address, because `bun run dev` binds `0.0.0.0` on purpose
 * (to be reachable through a container port mapping) — refusing on bind alone would break the
 * project's own dev command for a browser sitting on localhost.
 *
 * Returns the refusal text rather than a bare boolean so the socket can tell the user why;
 * a silently-refused upgrade is indistinguishable from a dropped connection.
 */
export function hostTerminalRefusal(req: Request): string | null {
	if (BASIC_AUTH_PASSWORD) return null;
	if (isLoopbackPeer(req)) return null;
	return (
		'Refusing to attach a sandboxed terminal to a remote client: this is a shell on the host, ' +
		'and this server has no BASIC_AUTH_PASSWORD set. Set one and reload, or open codebay from ' +
		'this machine.'
	);
}

const REALM = 'Codebay';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A cross-origin page can't set this without a CORS preflight this server never answers.
 * Basic Auth alone wouldn't stop CSRF — browsers auto-attach cached credentials.
 */
const CSRF_HEADER = 'x-codebay-request';

function challenge(): Response {
	return new Response('Authentication required', {
		status: 401,
		headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` }
	});
}

function csrfRejected(): Response {
	return new Response('Forbidden', { status: 403 });
}

/**
 * WS handshakes are GETs that slip past the CSRF check, and browsers attach cached
 * credentials cross-origin without a preflight. A missing Origin means a non-browser client.
 */
function wsOriginOk(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (origin == null) return true;
	try {
		return new URL(origin).host === request.headers.get('host');
	} catch {
		return false;
	}
}

/** `Mochi.ws` routes are dispatched by Bun directly and never reach `basicAuth`. */
export function wsUpgradeAllowed(request: Request): boolean {
	if (!wsOriginOk(request)) return false;
	if (!BASIC_AUTH_PASSWORD) return true;
	return credentialsOk(request.headers.get('Authorization'));
}

function credentialsOk(header: string | null): boolean {
	if (!header?.startsWith('Basic ')) return false;
	let decoded: string;
	try {
		decoded = atob(header.slice(6).trim());
	} catch {
		return false;
	}
	const sep = decoded.indexOf(':');
	if (sep === -1) return false;
	const user = decoded.slice(0, sep);
	const pass = decoded.slice(sep + 1);
	// Both halves must always run — an `&&` short-circuit would leak which one failed by timing.
	const userOk = timingSafeEqualStr(user, BASIC_AUTH_USERNAME);
	const passOk = timingSafeEqualStr(pass, BASIC_AUTH_PASSWORD);
	return userOk && passOk;
}

/**
 * The CSRF guard runs even with no password set: on an unauthenticated localhost
 * server it's the only thing between a malicious page and the destructive endpoints.
 */
export const basicAuth: Handle = async ({ event, resolve }) => {
	// The one place that sees the server on every request. `Mochi.ws` routes bypass this handle,
	// but the page load that opens them never does — so the sandbox terminal's peer check always
	// has a handle by the time an upgrade arrives, with or without a fresh `src/index.ts` run.
	if (event.server) setServer(event.server);

	const path = new URL(event.request.url).pathname;

	// Containers can carry neither the app password nor the CSRF header; the route checks a token.
	if (path.startsWith('/api/bridge/')) return resolve(event);

	// Covers the `/p/:id/*` proxy relay only; `Mochi.ws` routes call `wsUpgradeAllowed` themselves.
	if (
		event.request.headers.get('upgrade')?.toLowerCase() === 'websocket' &&
		!wsOriginOk(event.request)
	) {
		return csrfRejected();
	}

	// Scoped to /api/ so it never touches the request shapes code-server itself generates.
	if (
		path.startsWith('/api/') &&
		MUTATING_METHODS.has(event.request.method) &&
		event.request.headers.get(CSRF_HEADER) == null
	) {
		return csrfRejected();
	}

	if (!BASIC_AUTH_PASSWORD) return resolve(event);
	if (credentialsOk(event.request.headers.get('Authorization'))) return resolve(event);
	return challenge();
};
