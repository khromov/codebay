/** Shape every API route uses for its error responses (`apiError` in routes.ts). */
interface ApiErrorBody {
  error?: { message: string };
}

/**
 * Custom header attached to every request through this helper. The server's
 * CSRF guard (see auth.server.ts) requires it on mutating `/api/` requests — a
 * forged cross-site request can't set a custom header, so this is what proves
 * a mutation actually came from this app's own frontend.
 */
const APP_REQUEST_HEADER = 'X-Dcm-Request';

/**
 * Thin wrapper over `fetch` for the app's JSON API. Throws an `Error` carrying the
 * server's `{ error: { message } }` text (falling back to `fallbackMessage`) when
 * the response isn't ok, and otherwise returns the parsed JSON body typed as `T`.
 * Centralizes the `if (!res.ok) throw new Error(…)` dance that every mutation in
 * the UI was repeating, and tags every request with the header the server's CSRF
 * guard expects — so every caller gets that for free too.
 */
export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit,
  fallbackMessage = 'Request failed',
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      [APP_REQUEST_HEADER]: '1',
    },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(data?.error?.message ?? fallbackMessage);
  }
  return (await res.json().catch(() => ({}))) as T;
}

/** Convenience for a JSON POST: sets the header and serializes `body` when given. */
export function apiPost<T = unknown>(
  url: string,
  body?: unknown,
  fallbackMessage?: string,
): Promise<T> {
  return apiFetch<T>(
    url,
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
    fallbackMessage,
  );
}
