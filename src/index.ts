import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import { routes } from './routes.ts';
import { basicAuth } from './lib/auth.server.ts';
import { PROXY_PREFIX } from './lib/proxy.server.ts';
import {
	BASIC_AUTH_PASSWORD,
	HOST,
	PORT,
	PUBLIC_ORIGIN,
	TRUSTED_ORIGINS
} from './lib/config.server.ts';

if (!BASIC_AUTH_PASSWORD) {
	console.warn('⚠ BASIC_AUTH_PASSWORD is not set — the UI and all instances are unprotected.');
}
if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !BASIC_AUTH_PASSWORD) {
	console.warn(
		`⚠ Binding to ${HOST} (non-loopback) without a password — anyone on the network can reach this server.`
	);
}

await Mochi.serve({
	port: PORT,
	hostname: HOST,
	development: process.env.MODE === 'development',
	htmlShell: './src/shell.html',
	// Trailing-slash normalization is disabled entirely: the proxy's `/p/:id`
	// route does its own bare-`/p/<id>` → `/p/<id>/` redirect (code-server needs
	// the slash), and we don't want Mochi's global policy touching proxy paths.
	// Gate the whole app (UI, APIs, proxy) behind one Basic Auth password.
	handle: basicAuth,
	// The app is served same-origin (no reverse proxy by default). Pin the public
	// origin so Mochi's CSRF origin check accepts our own form POSTs in production
	// mode — without this it refuses every form mutation and warns about a missing
	// proxy.origin. Override PUBLIC_ORIGIN / TRUSTED_ORIGINS when fronted by a proxy.
	proxy: {
		origin: PUBLIC_ORIGIN
	},
	csrf: {
		trustedOrigins: TRUSTED_ORIGINS
	},
	filters: {
		'consoleLogger:line': (line, ctx) => {
			const kept = silenceInternalRoutes(line, ctx);
			if (kept == null) {
				return null;
			}
			if (ctx.source.name === 'ws:message' && ctx.path.startsWith(PROXY_PREFIX + '/')) {
				return null;
			}
			// The bridge fires on every Claude hook event (Stop/Notification/
			// UserPromptSubmit) — far more often than any human action — and these
			// requests carry the per-instance bridge token. Keep them out of the log
			// entirely rather than relying on remembering not to log secrets elsewhere.
			if (ctx.path.startsWith('/api/bridge/')) {
				return null;
			}
			return kept;
		},
		// Belt-and-suspenders: trailingSlash is off above, so this never fires
		// today. It stays as a guard — if the policy is ever re-enabled, proxy
		// paths under /p/ remain exempt so code-server's subpath isn't broken.
		'trailingSlash:redirect': (computed, { url }) =>
			url.pathname.startsWith(PROXY_PREFIX + '/') ? null : computed
	},
	routes
});

const url = 'http://localhost:' + PORT;
console.log(`Server running at ${url} (bound to ${HOST})`);

// Open the web UI in the user's default browser on startup.
// Set DISABLE_OPEN_BROWSER=1 to skip (e.g. headless or Claude Code runs).
if (process.env.DISABLE_OPEN_BROWSER !== '1') {
	const openCmd =
		process.platform === 'darwin'
			? ['open', url]
			: process.platform === 'win32'
				? ['cmd', '/c', 'start', '', url]
				: ['xdg-open', url];
	try {
		Bun.spawn(openCmd, { stdout: 'ignore', stderr: 'ignore' });
	} catch {
		// Browser launch is best-effort; ignore failures (e.g. headless environments).
	}
}
