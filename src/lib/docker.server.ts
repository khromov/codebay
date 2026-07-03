import { getDocker, resetDocker } from './docker-client.server.ts';

/** The HTTP status code dockerode attaches to a rejected request, if any. */
function statusOf(err: unknown): number | undefined {
	return (err as { statusCode?: number })?.statusCode;
}

/** True if the Docker daemon is reachable. */
export async function dockerAvailable(): Promise<boolean> {
	try {
		await (await getDocker()).ping();
		return true;
	} catch {
		// The daemon may have started/stopped/switched context since we resolved the
		// client. Drop the cached client so the next probe re-resolves the live socket
		// and can recover without a server restart. This runs every few seconds via the
		// background preflight tick, so recovery is automatic.
		resetDocker();
		return false;
	}
}

/**
 * The Docker *daemon's* CPU architecture (e.g. `arm64`, `amd64`) — Go's `runtime.GOARCH`,
 * which is what images are pulled for. This is the arch that matters when picking a base
 * image, not the host CLI's, since the daemon may be a remote/VM context (Colima, etc.).
 * Returns null when the daemon is unreachable.
 */
export async function dockerArch(): Promise<string | null> {
	try {
		const arch = (await (await getDocker()).version()).Arch;
		return arch || null;
	} catch {
		return null;
	}
}

/**
 * Whether a container exists and is currently running. Resolves the active Docker
 * context (Docker Desktop, Colima, OrbStack, remote) via the shared dockerode client.
 */
export async function isRunning(containerId: string): Promise<boolean> {
	try {
		const info = await (await getDocker()).getContainer(containerId).inspect();
		return info.State?.Running === true;
	} catch {
		return false; // missing container (404) or daemon unreachable
	}
}

/**
 * Container ports currently published to the host, per `docker inspect` (the same
 * mappings `docker ps` shows in its PORTS column). Reads the live binding table
 * rather than execing inside the container, so it reflects what Docker actually
 * exposes. Returns the deduped set of container port numbers that have a host
 * binding; `[]` on any failure.
 */
export async function publishedContainerPorts(containerId: string): Promise<number[]> {
	let ports: Record<string, { HostPort?: string }[] | null>;
	try {
		const info = await (await getDocker()).getContainer(containerId).inspect();
		ports = (info.NetworkSettings?.Ports ?? {}) as Record<string, { HostPort?: string }[] | null>;
	} catch {
		return [];
	}
	const open = new Set<number>();
	for (const [key, bindings] of Object.entries(ports)) {
		if (!bindings || bindings.length === 0) continue; // exposed but not published
		const port = Number.parseInt(key, 10); // "3000/tcp" → 3000
		if (Number.isInteger(port) && port > 0) open.add(port);
	}
	return [...open];
}

export async function startContainer(containerId: string): Promise<boolean> {
	try {
		await (await getDocker()).getContainer(containerId).start();
		return true;
	} catch (err) {
		return statusOf(err) === 304; // already started
	}
}

export async function stopContainer(containerId: string): Promise<boolean> {
	try {
		await (await getDocker()).getContainer(containerId).stop();
		return true;
	} catch (err) {
		return statusOf(err) === 304; // already stopped
	}
}

/**
 * Force-remove a container *and* the volumes attached to it; treats an
 * already-absent container as success. We inspect the container first to
 * discover its `volume` mounts (bind mounts like the workspace copy are
 * skipped), then remove the container with `v: true` — which drops the
 * container's *anonymous* volumes — and finally remove any *named* volumes
 * explicitly, since the engine never auto-removes those. Volume removal is
 * best-effort: a 404 (already gone, e.g. an anonymous volume dropped by
 * `v: true`) or 409 (still in use) must not make the delete fail.
 */
export async function removeContainer(containerId: string): Promise<boolean> {
	const docker = await getDocker();
	const container = docker.getContainer(containerId);

	let volumeNames: string[];
	try {
		const info = await container.inspect();
		volumeNames = (info.Mounts ?? [])
			.filter((m) => m.Type === 'volume' && m.Name)
			.map((m) => m.Name!);
	} catch (err) {
		if (statusOf(err) !== 404) throw err;
		return true; // no such container — nothing to clean up
	}

	try {
		await container.remove({ force: true, v: true });
	} catch (err) {
		if (statusOf(err) !== 404) return false; // already absent counts as success
	}

	for (const name of volumeNames) {
		try {
			await docker.getVolume(name).remove({ force: true });
		} catch {
			// best-effort: anonymous volume already dropped by `v: true` (404),
			// or a shared volume still in use (409) — leave it be.
		}
	}
	return true;
}
