import { dockerEnv } from './config.server.ts';

/** Run a command to completion, capturing stdout/stderr and the exit code. */
async function run(cmd: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: dockerEnv() });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** True if the Docker CLI is installed and the daemon is reachable. */
export async function dockerAvailable(): Promise<boolean> {
  return (await run(['docker', 'info', '--format', '{{.ServerVersion}}'])).ok;
}

/**
 * Whether a container exists and is currently running. Uses the Docker CLI so it
 * honors the user's active Docker context (Docker Desktop, Colima, OrbStack, remote)
 * instead of guessing a socket path.
 */
export async function isRunning(containerId: string): Promise<boolean> {
  const res = await run(['docker', 'inspect', '-f', '{{.State.Running}}', containerId]);
  return res.ok && res.stdout === 'true';
}

/**
 * Container ports currently published to the host, per `docker inspect` (the same
 * mappings `docker ps` shows in its PORTS column). Reads the live binding table
 * rather than execing inside the container, so it reflects what Docker actually
 * exposes. Returns the deduped set of container port numbers that have a host
 * binding; `[]` on any failure.
 */
export async function publishedContainerPorts(containerId: string): Promise<number[]> {
  const res = await run([
    'docker', 'inspect', '-f', '{{json .NetworkSettings.Ports}}', containerId,
  ]);
  if (!res.ok) return [];
  let ports: Record<string, { HostPort?: string }[] | null>;
  try {
    ports = JSON.parse(res.stdout) as Record<string, { HostPort?: string }[] | null>;
  } catch {
    return [];
  }
  const open = new Set<number>();
  for (const [key, bindings] of Object.entries(ports ?? {})) {
    if (!bindings || bindings.length === 0) continue; // exposed but not published
    const port = Number.parseInt(key, 10); // "3000/tcp" → 3000
    if (Number.isInteger(port) && port > 0) open.add(port);
  }
  return [...open];
}

export async function startContainer(containerId: string): Promise<boolean> {
  return (await run(['docker', 'start', containerId])).ok;
}

export async function stopContainer(containerId: string): Promise<boolean> {
  return (await run(['docker', 'stop', containerId])).ok;
}

/**
 * Mark a path as a safe git directory for the container user. The workspace is
 * copied from the host, so its `.git` is owned by a different UID than the
 * container user — without this, git aborts every command with "dubious
 * ownership". Defaults to `*` since instances are throwaway and single-tenant.
 */
export async function markGitSafeDirectory(
  containerId: string,
  remoteUser: string | undefined,
  dir = '*',
): Promise<{ ok: boolean; error?: string }> {
  const user = remoteUser?.trim() || 'root';
  const res = await run([
    'docker', 'exec', '-u', user, containerId,
    'git', 'config', '--global', '--add', 'safe.directory', dir,
  ]);
  return res.ok ? { ok: true } : { ok: false, error: res.stderr || `exit code` };
}

/** Force-remove a container; treats an already-absent container as success. */
export async function removeContainer(containerId: string): Promise<boolean> {
  const res = await run(['docker', 'rm', '-f', containerId]);
  return res.ok || res.stderr.includes('No such container');
}
