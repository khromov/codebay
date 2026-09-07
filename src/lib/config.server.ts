import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Defaults outside the project tree; a relative `DATA_DIR` resolves against cwd. */
export const DATA_DIR = process.env.DATA_DIR
	? isAbsolute(process.env.DATA_DIR)
		? process.env.DATA_DIR
		: resolve(process.cwd(), process.env.DATA_DIR)
	: join(homedir(), '.codebay');

/**
 * Without a stable key Mochi mints a random one per boot, so anything it signed
 * stops verifying after a restart. Must run before `Mochi.serve()` reads the env.
 */
export function ensureMochiKey(): void {
	if (process.env.MOCHI_KEY?.trim()) {
		return;
	}
	const keyPath = join(DATA_DIR, 'mochi-key');
	try {
		if (existsSync(keyPath)) {
			const existing = readFileSync(keyPath, 'utf8').trim();
			if (existing) {
				process.env.MOCHI_KEY = existing;
				return;
			}
		}
		const key = randomBytes(32).toString('base64url');
		mkdirSync(DATA_DIR, { recursive: true });
		writeFileSync(keyPath, key + '\n', { mode: 0o600 });
		process.env.MOCHI_KEY = key;
	} catch (err) {
		console.warn(`⚠ Could not persist a MOCHI_KEY in ${DATA_DIR}: ${(err as Error).message}`);
	}
}

/** Read relative to this module, not cwd, because under `bunx codebay` cwd is the user's folder. */
export const APP_VERSION: string = (() => {
	try {
		const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
		const version = JSON.parse(readFileSync(path, 'utf8')).version;
		return typeof version === 'string' ? version : 'unknown';
	} catch {
		return 'unknown';
	}
})();

/** Per-instance working copies live here: <INSTANCES_DIR>/<id>/workspace. */
export const INSTANCES_DIR = join(DATA_DIR, 'instances');

/** Extracted Claude Code logs, in one flat folder that outlives the instances they came from. */
export const LOGS_DIR = join(DATA_DIR, 'logs');

export const DB_PATH = join(DATA_DIR, 'app.sqlite');

export const PORT_BASE = 8001;
export const PORT_MAX = 8999;

/** Inside the container, not on the host. */
export const CODE_SERVER_PORT = 8080;

/** ttyd's default listen port, used in terminal mode instead of code-server's. */
export const TTYD_PORT = 7681;

/** `base:ubuntu` is multi-arch, unlike the `universal` images, which are amd64-only. */
export const DEFAULT_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';

/** An unset/empty password disables the gate entirely (local dev). */
export const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME || 'admin';
export const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';

/** Loopback by default so an instance with no password isn't exposed to the LAN. */
export const HOST = process.env.HOST || '127.0.0.1';

/**
 * Forwarded app ports follow the server's bind; code-server's own port never does
 * (it runs with auth disabled). Anything but `0.0.0.0` degrades to loopback rather
 * than risking an appPort string Docker rejects.
 */
export const PUBLISH_HOST = HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';

export const PORT = Number(process.env.PORT) || 6969;

/** Mochi's CSRF origin check compares against these; override when behind a proxy. */
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN?.trim() || `http://localhost:${PORT}`;
export const TRUSTED_ORIGINS = (process.env.TRUSTED_ORIGINS || '')
	.split(',')
	.map((o) => o.trim())
	.filter(Boolean);

/**
 * Set to skip host-credential discovery, e.g. on a server with no Keychain.
 * A token entered in Settings still outranks these; see the credential injections.
 */
export const CLAUDE_CODE_TOKEN =
	(process.env.CODEBAY_CLAUDE_CODE_TOKEN ?? process.env.DCM_CLAUDE_CODE_TOKEN)?.trim() || '';
export const GITHUB_TOKEN =
	(process.env.CODEBAY_GITHUB_TOKEN ?? process.env.DCM_GITHUB_TOKEN)?.trim() || '';

/** macOS only — the Linux fallback (~/.claude/.credentials.json) has no service name. */
export const CLAUDE_KEYCHAIN_SERVICE =
	process.env.CODEBAY_CLAUDE_KEYCHAIN_SERVICE?.trim() || 'Claude Code-credentials';

/**
 * `.git` is deliberately absent so each instance keeps its history/remote.
 * An explicit empty string (as opposed to unset) means "copy everything".
 */
export const DEFAULT_COPY_IGNORE = 'node_modules';

export function parseCopyIgnore(raw: string): Set<string> {
	return new Set(
		raw
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean)
	);
}

/** When unset, the docker/devcontainer CLIs resolve the current Docker context themselves. */
export const DOCKER_HOST = process.env.DOCKER_HOST?.trim() || '';

/** Keeps spawned `docker`/`devcontainer` processes pointed at the same daemon we use. */
export function dockerEnv(): Record<string, string | undefined> {
	return DOCKER_HOST ? { ...process.env, DOCKER_HOST } : process.env;
}

/**
 * Windows picks an executable by PATHEXT, which `existsSync` doesn't apply — so each shim has
 * to be probed by full name. The bare name is deliberately not a win32 candidate: npm writes a
 * POSIX sh script there, which Bun can't exec. Bun's `.bunx` sibling is a data file and is never
 * a candidate on any platform — spawning it throws EFTYPE.
 */
const BIN_SHIM_EXTS = process.platform === 'win32' ? ['.exe', '.cmd'] : [''];

/** Null when no spawnable shim exists, so a caller can fall back instead of spawning a missing file. */
export function binShim(binDir: string, name: string): string | null {
	for (const ext of BIN_SHIM_EXTS) {
		const candidate = join(binDir, name + ext);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * An argv rather than a path, because the `devcontainer.js` fallback leads with a
 * `#!/usr/bin/env node` shebang that Windows doesn't honour — there it only runs when handed to
 * an interpreter. Resolved from our own dependency tree, not cwd, because under `bunx codebay`
 * cwd is the user's arbitrary folder.
 */
export function devcontainerBin(): string[] {
	try {
		const pkgJson = fileURLToPath(import.meta.resolve('@devcontainers/cli/package.json'));
		const shim = binShim(join(dirname(pkgJson), '..', '..', '.bin'), 'devcontainer');
		if (shim) return [shim];
		const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
		const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.devcontainer;
		if (rel) {
			const js = join(dirname(pkgJson), rel);
			return process.platform === 'win32' ? [process.execPath, js] : [js];
		}
	} catch {
		// Fall through to the dev-checkout path below.
	}
	const dir = join(process.cwd(), 'node_modules', '.bin');
	return [binShim(dir, 'devcontainer') ?? join(dir, 'devcontainer')];
}
