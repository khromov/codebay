import { getDocker, resetDocker } from './docker-client.server.ts';

function statusOf(err: unknown): number | undefined {
	return (err as { statusCode?: number })?.statusCode;
}

export async function dockerAvailable(): Promise<boolean> {
	try {
		await (await getDocker()).ping();
		return true;
	} catch {
		// Re-resolve on the next probe, in case the daemon moved or switched context.
		resetDocker();
		return false;
	}
}

/** The daemon's arch, not the host's — images are pulled for the daemon, which may be a VM. */
export async function dockerArch(): Promise<string | null> {
	try {
		const arch = (await (await getDocker()).version()).Arch;
		return arch || null;
	} catch {
		return null;
	}
}

export async function isRunning(containerId: string): Promise<boolean> {
	try {
		const info = await (await getDocker()).getContainer(containerId).inspect();
		return info.State?.Running === true;
	} catch {
		return false; // missing container (404) or daemon unreachable
	}
}

/** Reads Docker's live binding table, so it reflects what's actually exposed. */
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

/**
 * Covers containers codebay has no DB row for, which would otherwise get their port
 * handed out twice. Stopped containers don't hold a bind, hence the running-only default.
 */
export async function hostPortsInUse(): Promise<number[]> {
	try {
		const containers = await (await getDocker()).listContainers();
		const ports = new Set<number>();
		for (const c of containers) {
			for (const p of c.Ports ?? []) {
				if (p.PublicPort) ports.add(p.PublicPort);
			}
		}
		return [...ports];
	} catch {
		return [];
	}
}

/** Goes through the raw modem because dockerode has no helper for `/build/prune`. */
export async function pruneBuildCache(): Promise<{ spaceReclaimed: number }> {
	const docker = await getDocker();
	const data = await new Promise<{ SpaceReclaimed?: number } | undefined>((resolve, reject) =>
		docker.modem.dial(
			{
				path: '/build/prune?all=true',
				method: 'POST',
				statusCodes: { 200: true, 500: 'server error' }
			},
			(err: unknown, res: unknown) =>
				err ? reject(err) : resolve(res as { SpaceReclaimed?: number } | undefined)
		)
	);
	return { spaceReclaimed: data?.SpaceReclaimed ?? 0 };
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

/** Named volumes must be listed before removal and dropped by hand — the engine never reaps them. */
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
			// Already dropped by `v: true` (404) or still shared with another container (409).
		}
	}
	return true;
}
