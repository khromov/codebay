import type { Handle } from 'mochi-framework';
import { BASIC_AUTH_PASSWORD, BASIC_AUTH_USERNAME } from './config.server.ts';

const REALM = 'Devcontainers Manager';

function challenge(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
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
  return user === BASIC_AUTH_USERNAME && pass === BASIC_AUTH_PASSWORD;
}

/**
 * Global Basic Auth gate. Runs on every routed request *and* the proxy fallback
 * (Mochi's `handle` wraps both), so one password protects the UI, the APIs, and
 * every proxied code-server — including WebSocket upgrades, which browsers send
 * with the cached `Authorization` header. Disabled when no password is set.
 */
export const basicAuth: Handle = async ({ event, resolve }) => {
  if (!BASIC_AUTH_PASSWORD) return resolve(event);
  // The CLI bridge has its own per-instance bearer-token auth, and the
  // in-container shim has no way to know the Basic Auth password. Let it through;
  // handleBridgeExec rejects requests without a valid token.
  if (new URL(event.request.url).pathname === '/api/bridge/exec') return resolve(event);
  if (credentialsOk(event.request.headers.get('Authorization'))) return resolve(event);
  return challenge();
};
