/**
 * Forwarded ports are published on the machine running codebay, which is only
 * `localhost` when the browser is on that same machine — under HOST=0.0.0.0 it
 * isn't. SSR has no `window`, so the first paint falls back to localhost.
 */
export function forwardedPortUrl(hostPort: number): string {
	const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
	return `http://${host}:${hostPort}`;
}
