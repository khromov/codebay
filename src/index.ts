import { Mochi, sequence, silenceInternalRoutes } from 'mochi-framework';
import { routes } from './routes.ts';
import { basicAuth, tokenAuthenticated } from './lib/auth.server.ts';
import { themeHandle } from './lib/theme.server.ts';
import { PROXY_PREFIX } from './lib/proxy.server.ts';
import { resumeRuns } from './lib/agent-runs.server.ts';
import { warnIfBuildStale } from './lib/build-freshness.server.ts';
import { LOCK_STALE_MS, acquireDataDirLock } from './lib/data-dir-lock.server.ts';
import {
	APP_VERSION,
	BASIC_AUTH_PASSWORD,
	DATA_DIR,
	HOST,
	PORT,
	PUBLIC_ORIGIN,
	TRUSTED_ORIGINS,
	ensureMochiKey
} from './lib/config.server.ts';

if (!BASIC_AUTH_PASSWORD) {
	console.warn('⚠ BASIC_AUTH_PASSWORD is not set — the UI and all instances are unprotected.');
}
if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !BASIC_AUTH_PASSWORD) {
	console.warn(
		`⚠ Binding to ${HOST} (non-loopback) without a password — anyone on the network can reach this server.`
	);
}
warnIfBuildStale();

const lock = acquireDataDirLock(DATA_DIR);
if (!lock.ok) {
	const who = lock.holder
		? `pid ${lock.holder.pid} on ${lock.holder.host}, started ${new Date(lock.holder.startedAt).toLocaleString()}`
		: 'an unknown process';
	console.error(
		`✖ Another codebay manager (${who}) is already using ${DATA_DIR}. Two managers on one data dir ` +
			"poll the same runs and overwrite each other's rows — stop it, or start this one with a " +
			`different DATA_DIR. A crashed manager's lock (${lock.path}) clears itself after ${LOCK_STALE_MS / 1000}s.`
	);
	process.exit(1);
}
// A default Ctrl-C skips the exit hooks, and an unreleased lock refuses the restart that follows.
process.on('exit', () => lock.release());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => process.exit(signal === 'SIGINT' ? 130 : 143));
}

// Must precede Mochi.serve(), which is where MOCHI_KEY is read.
ensureMochiKey();

// Agent runs outlive the process that started them, so re-attach pollers to anything still in flight.
resumeRuns();

await Mochi.serve({
	port: PORT,
	hostname: HOST,
	// Bun defaults to 10s and aborts slower form POSTs mid-flight; passed through to Bun.serve.
	idleTimeout: 120,
	development: process.env.MODE === 'development',
	htmlShell: './src/shell.html',
	handle: sequence(basicAuth, themeHandle),
	// Without a pinned origin, Mochi's CSRF check refuses every form POST in production.
	proxy: {
		origin: PUBLIC_ORIGIN
	},
	csrf: {
		trustedOrigins: TRUSTED_ORIGINS
	},
	filters: {
		// Containers and MCP clients send no Origin header, which the check would 403; safe because
		// those routes authenticate by token, not ambient browser credentials.
		'csrf:check': (decision, { url }) => (tokenAuthenticated(url.pathname) ? null : decision),
		'consoleLogger:line': (line, ctx) => {
			const kept = silenceInternalRoutes(line, ctx);
			if (kept == null) {
				return null;
			}
			if (ctx.source.name === 'ws:message' && ctx.path.startsWith(PROXY_PREFIX + '/')) {
				return null;
			}
			// A line per Claude hook event or JSON-RPC frame is noise, and each would print its token.
			if (tokenAuthenticated(ctx.path)) {
				return null;
			}
			return kept;
		},
		// Dormant while trailingSlash is off, but keeps code-server's subpath safe if it returns.
		'trailingSlash:redirect': (computed, { url }) =>
			url.pathname.startsWith(PROXY_PREFIX + '/') ? null : computed
	},
	routes
});

const url = 'http://localhost:' + PORT;
console.log(`codebay v${APP_VERSION} — server running at ${url} (bound to ${HOST})`);

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
		// Best-effort — a headless host has nothing to open.
	}
}
