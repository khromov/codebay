import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Root directory where all manager state (SQLite db + instance workspaces) lives.
 * Defaults to `~/.codebay`, outside the project tree. Override with
 * the `DATA_DIR` env var; relative values are resolved against the current working
 * directory (e.g. `DATA_DIR=./.codebay` keeps everything project-local
 * for development).
 */
export const DATA_DIR = process.env.DATA_DIR
	? isAbsolute(process.env.DATA_DIR)
		? process.env.DATA_DIR
		: resolve(process.cwd(), process.env.DATA_DIR)
	: join(homedir(), '.codebay');

/** Per-instance working copies live here: <INSTANCES_DIR>/<id>/workspace. */
export const INSTANCES_DIR = join(DATA_DIR, 'instances');

/** SQLite database holding the durable record of every instance. */
export const DB_PATH = join(DATA_DIR, 'app.sqlite');

/** First host port handed out to a code-server instance; subsequent ones count up. */
export const PORT_BASE = 8001;
export const PORT_MAX = 8999;

/** Port code-server listens on *inside* every container. */
export const CODE_SERVER_PORT = 8080;

/**
 * Image used when a selected folder has no .devcontainer/devcontainer.json.
 * `base:ubuntu` is multi-arch (amd64 + arm64), so it pulls on Apple Silicon too — unlike the
 * `universal` images, which are amd64-only. Override per-install via the Settings tab.
 */
export const DEFAULT_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';

/**
 * HTTP Basic Auth gate for the whole app (UI, APIs, and the code-server proxy).
 * When BASIC_AUTH_PASSWORD is unset/empty the gate is disabled (local dev).
 */
export const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME || 'admin';
export const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';

/**
 * Interface the server binds to. Defaults to loopback so an unprotected instance
 * (no BASIC_AUTH_PASSWORD) isn't exposed to the LAN. Set HOST=0.0.0.0 to opt into
 * binding all interfaces (e.g. remote access) — do so together with a password.
 */
export const HOST = process.env.HOST || '127.0.0.1';

/** TCP port the server listens on. */
export const PORT = Number(process.env.PORT) || 3333;

/**
 * Public origin the browser reaches this server on, used for Mochi's CSRF
 * origin check (and to silence its "no proxy.origin" warning in production).
 * Defaults to `http://localhost:<PORT>` for local access; override with
 * PUBLIC_ORIGIN when fronted by a reverse proxy or a custom hostname. Extra
 * allowed origins (e.g. a LAN IP) can be passed comma-separated in TRUSTED_ORIGINS.
 */
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN?.trim() || `http://localhost:${PORT}`;
export const TRUSTED_ORIGINS = (process.env.TRUSTED_ORIGINS || '')
	.split(',')
	.map((o) => o.trim())
	.filter(Boolean);

/**
 * Optional token overrides for credential injection. When set, the manager injects
 * this token into every container instead of discovering the host's credentials
 * (macOS Keychain / ~/.claude / `gh auth token`). Useful on servers/CI or to pin a
 * specific identity. A token entered in Settings ("Set tokens manually") takes
 * precedence over these env vars; see the two credential injections for the order.
 * The legacy `DCM_*` names are still honored as a fallback.
 */
export const CLAUDE_CODE_TOKEN =
	(process.env.CODEBAY_CLAUDE_CODE_TOKEN ?? process.env.DCM_CLAUDE_CODE_TOKEN)?.trim() || '';
export const GITHUB_TOKEN =
	(process.env.CODEBAY_GITHUB_TOKEN ?? process.env.DCM_GITHUB_TOKEN)?.trim() || '';

/**
 * macOS Keychain service name Claude Code's OAuth credentials are read from
 * (`security find-generic-password -s <name>`). Override to point host-credential
 * discovery at a different Keychain entry, e.g. a secondary account. macOS only —
 * the Linux/other fallback (~/.claude/.credentials.json) has no service name.
 */
export const CLAUDE_KEYCHAIN_SERVICE =
	process.env.CODEBAY_CLAUDE_KEYCHAIN_SERVICE?.trim() || 'Claude Code-credentials';

/**
 * Directories skipped when copying a source folder into an instance workspace.
 * `.git` is intentionally kept so each instance retains its history/remote and
 * `git pull`/`push` work (authenticated by the injected gh credentials).
 */
export const COPY_IGNORE = new Set(['node_modules']);

/**
 * Docker daemon to connect to, e.g. `unix:///var/run/docker.sock`,
 * `unix://$HOME/.colima/default/docker.sock`, or `tcp://1.2.3.4:2375`. When unset, the
 * docker/devcontainer CLIs fall back to their own resolution (current Docker context).
 * Standard `DOCKER_HOST` so it interoperates with existing Docker tooling.
 */
export const DOCKER_HOST = process.env.DOCKER_HOST?.trim() || '';

/**
 * Environment for spawned `docker`/`devcontainer` processes: the inherited env with
 * `DOCKER_HOST` applied when configured, so every Docker operation targets the same daemon.
 */
export function dockerEnv(): Record<string, string | undefined> {
	return DOCKER_HOST ? { ...process.env, DOCKER_HOST } : process.env;
}

/**
 * Resolve the @devcontainers/cli binary from our own dependency tree rather than
 * the cwd, so it works when installed globally / via `bunx codebay` (where cwd is
 * the user's arbitrary folder). Falls back to the cwd-local path for dev checkouts.
 */
export function devcontainerBin(): string {
	try {
		const pkgJson = fileURLToPath(import.meta.resolve('@devcontainers/cli/package.json'));
		// <node_modules>/@devcontainers/cli/package.json -> <node_modules>/.bin/devcontainer
		const shim = join(dirname(pkgJson), '..', '..', '.bin', 'devcontainer');
		if (existsSync(shim)) return shim;
		// Fallback: the package's own bin entry (a node-shebanged .js).
		const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
		const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.devcontainer;
		if (rel) return join(dirname(pkgJson), rel);
	} catch {
		// Fall through to the dev-checkout path below.
	}
	return join(process.cwd(), 'node_modules', '.bin', 'devcontainer');
}
