import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root directory where all manager state lives, outside the project tree. */
export const DATA_DIR = join(homedir(), '.devcontainers-manager');

/** Per-instance working copies live here: <INSTANCES_DIR>/<id>/workspace. */
export const INSTANCES_DIR = join(DATA_DIR, 'instances');

/** SQLite database holding the durable record of every instance. */
export const DB_PATH = join(DATA_DIR, 'app.sqlite');

/** First host port handed out to a code-server instance; subsequent ones count up. */
export const PORT_BASE = 8001;
export const PORT_MAX = 8999;

/** Port code-server listens on *inside* every container. */
export const CODE_SERVER_PORT = 8080;

/** Image used when a selected folder has no .devcontainer/devcontainer.json. */
export const DEFAULT_IMAGE = 'mcr.microsoft.com/devcontainers/universal:2';

/**
 * HTTP Basic Auth gate for the whole app (UI, APIs, and the code-server proxy).
 * When BASIC_AUTH_PASSWORD is unset/empty the gate is disabled (local dev).
 */
export const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME || 'admin';
export const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';

/** Directories skipped when copying a source folder into an instance workspace. */
export const COPY_IGNORE = new Set(['node_modules', '.git']);

/**
 * Host CLIs the in-container bridge shim is allowed to forward to the host. The
 * shim runs the *real* tool on the host with the host's auth (see bridge.server.ts).
 * Keep this list tight — every entry is a command a container can run on the host.
 * Add e.g. 'claude' here to bridge `claude -p`.
 */
export const BRIDGE_ALLOWED_TOOLS = new Set<string>(['gh']);

/** Filename of the staged bridge shim inside each workspace's .devcontainer/. */
export const BRIDGE_SHIM_FILE = 'dcm-bridge-shim.sh';

/** Base URL the in-container shim uses to reach the host bridge endpoint. */
export function bridgeUrl(): string {
  const port = Number(process.env.PORT) || 3333;
  return `http://host.docker.internal:${port}`;
}

/** Resolve the bundled @devcontainers/cli binary, preferring the local install. */
export function devcontainerBin(): string {
  return join(process.cwd(), 'node_modules', '.bin', 'devcontainer');
}
