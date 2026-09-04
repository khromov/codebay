import type { Handle } from 'mochi-framework';
import { BASIC_AUTH_PASSWORD, BASIC_AUTH_USERNAME } from './config.server.ts';
import { timingSafeEqualStr } from './crypto.server.ts';
import { MCP_PATH } from './mcp-auth.server.ts';

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
	const path = new URL(event.request.url).pathname;

	// Containers can carry neither the app password nor the CSRF header; the route checks a token.
	if (path.startsWith('/api/bridge/')) return resolve(event);

	// Same trade for MCP clients: one bearer token instead of the app password, checked by the route.
	if (path === MCP_PATH) return resolve(event);

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
