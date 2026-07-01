import Docker from 'dockerode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCKER_HOST, dockerEnv } from './config.server.ts';

/**
 * Shared dockerode client. Every Docker Engine operation goes through `getDocker()`
 * so they all target the same daemon. The instance is pinned to `globalThis` (like the
 * hub, log registry, and db handle) so dev-mode hot reload doesn't reopen connections.
 *
 * dockerode honors `DOCKER_HOST` but — unlike the `docker` CLI — does NOT read the
 * active `docker context`. The `@devcontainers/cli` we shell out to *does* use the
 * context, so to connect to the same daemon we resolve the socket once at startup:
 *   1. `DOCKER_HOST` if set (parsed into dockerode opts),
 *   2. otherwise a one-time `docker context inspect` to read the active context's host,
 *   3. otherwise the default `/var/run/docker.sock`.
 * This single `docker context inspect` is the only place we still spawn the CLI, and it
 * exists purely for connection discovery — never for an actual Docker operation.
 */

const g = globalThis as unknown as { __dcmDocker?: Promise<Docker> };

export function getDocker(): Promise<Docker> {
  return (g.__dcmDocker ??= resolveDocker());
}

/**
 * Drop the cached client so the next `getDocker()` re-resolves the active context
 * and socket. Call this when a connection-level operation fails: the daemon may
 * have started, stopped, or switched context (e.g. `colima start` flips the active
 * context to a different socket) since we last resolved — without this, the pinned
 * client keeps targeting a now-dead socket for the whole process lifetime.
 */
export function resetDocker(): void {
  g.__dcmDocker = undefined;
}

async function resolveDocker(): Promise<Docker> {
  const host = DOCKER_HOST || (await dockerContextHost()) || '';
  return new Docker(host ? parseDockerHost(host) : { socketPath: '/var/run/docker.sock' });
}

/** Read the active Docker context's daemon host via the CLI, once. `''` on any failure. */
async function dockerContextHost(): Promise<string> {
  try {
    const proc = Bun.spawn(
      ['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { stdout: 'pipe', stderr: 'ignore', env: dockerEnv() },
    );
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 ? out.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Load the TLS client materials Docker uses for a secured TCP daemon, from
 * `DOCKER_CERT_PATH` (or `~/.docker` as Docker itself defaults). Returns an empty
 * object if a file is missing so the connection can still be attempted (and fail
 * with a clear TLS error) rather than throwing here.
 */
function tlsMaterials(): { ca?: Buffer; cert?: Buffer; key?: Buffer } {
  const dir = process.env.DOCKER_CERT_PATH?.trim() || join(process.env.HOME ?? '', '.docker');
  const read = (name: string): Buffer | undefined => {
    try {
      return readFileSync(join(dir, name));
    } catch {
      return undefined;
    }
  };
  return { ca: read('ca.pem'), cert: read('cert.pem'), key: read('key.pem') };
}

/**
 * Parse a `DOCKER_HOST`-style daemon URL into dockerode connection options.
 *   `unix:///path/to.sock`  → { socketPath: '/path/to.sock' }
 *   `tcp://host:port`       → { host, port, protocol }
 * When `DOCKER_TLS_VERIFY` is set, switches to https and loads the CA/cert/key
 * from `DOCKER_CERT_PATH` (default `~/.docker`), matching the docker CLI.
 * (Windows `npipe://` is not supported here — this app runs on macOS/Linux.)
 */
export function parseDockerHost(host: string): Docker.DockerOptions {
  if (host.startsWith('unix://')) {
    return { socketPath: host.slice('unix://'.length) };
  }
  const tls = (process.env.DOCKER_TLS_VERIFY ?? '') !== '';
  const url = new URL(host.includes('://') ? host : `tcp://${host}`);
  const base: Docker.DockerOptions = {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : tls ? 2376 : 2375,
    protocol: tls ? 'https' : 'http',
  };
  // A TLS daemon needs the client cert/key (and CA) or the handshake fails.
  return tls ? { ...base, ...tlsMaterials() } : base;
}
