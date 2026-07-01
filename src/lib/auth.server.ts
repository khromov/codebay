import type { Handle } from 'mochi-framework';
import { BASIC_AUTH_PASSWORD, BASIC_AUTH_USERNAME } from './config.server.ts';
import { timingSafeEqualStr } from './crypto.server.ts';

const REALM = 'Devcontainers Manager';

/** Methods that mutate state — the ones the CSRF guard below applies to. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Custom header every same-origin mutation from this app's own frontend sends
 * (see `apiFetch` in src/api.ts). Plain HTML form submissions can't set custom
 * headers at all, and a cross-origin `fetch` can't attach one without
 * triggering a CORS preflight — which this server never answers with
 * permissive CORS headers, so the browser blocks the request before it's even
 * sent. Either way, requiring this header on mutating API calls blocks the
 * classic "victim has a logged-in browser, a malicious page silently POSTs to
 * our API" CSRF pattern, which Basic Auth alone (unlike cookies + SameSite)
 * doesn't defend against — the browser auto-attaches cached credentials to
 * same-realm requests regardless of which page triggered them.
 */
const CSRF_HEADER = 'x-dcm-request';

function challenge(): Response {
	return new Response('Authentication required', {
		status: 401,
		headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` }
	});
}

function csrfRejected(): Response {
	return new Response('Forbidden', { status: 403 });
}

/** Validate an `Authorization: Basic <base64>` header against the configured creds. */
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
	// Constant-time compares so a wrong username/password can't be distinguished by
	// response timing. Both halves always run — no `&&` short-circuit on the first.
	const userOk = timingSafeEqualStr(user, BASIC_AUTH_USERNAME);
	const passOk = timingSafeEqualStr(pass, BASIC_AUTH_PASSWORD);
	return userOk && passOk;
}

/**
 * Global Basic Auth gate, plus a lightweight CSRF guard for the JSON API. Runs
 * on every routed request *and* the proxy fallback (Mochi's `handle` wraps
 * both), so one password protects the UI, the APIs, and every proxied
 * code-server — including WebSocket upgrades, which browsers send with the
 * cached `Authorization` header.
 *
 * The CSRF guard applies even when `BASIC_AUTH_PASSWORD` is unset: with no
 * password configured there's no auth barrier at all, which makes a drive-by
 * cross-site request to a destructive endpoint (delete-all, shutdown) the
 * *only* thing standing between a malicious page and this server while it's
 * running on localhost — so it stays on regardless of the auth/password state.
 */
export const basicAuth: Handle = async ({ event, resolve }) => {
	const path = new URL(event.request.url).pathname;

	// The container→manager bridge can't carry the app password or our custom
	// CSRF header; it authenticates with a per-instance token validated by the
	// route itself, so it's exempt from both checks here.
	if (path.startsWith('/api/bridge/')) return resolve(event);

	// CSRF guard — scoped to /api/ so it never touches the code-server proxy
	// (/p/:id/*), which has its own request shapes the editor itself generates.
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
