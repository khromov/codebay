import { PORT_BASE, PORT_MAX } from './config.server.ts';

/** Kept pure so `allocatePort`'s union logic is testable without a DB or Docker daemon. */
export function pickFreePort(usedSets: ReadonlySet<number>[]): number {
	for (let port = PORT_BASE; port <= PORT_MAX; port++) {
		if (usedSets.every((s) => !s.has(port))) return port;
	}
	throw new Error('No free host ports available.');
}

/**
 * A listener outside Docker's view is invisible to the DB/Docker union — and on a VM-backed daemon
 * the collision never surfaces as an error, because the `-p` bind happens inside the VM where the
 * port is free while the host-side forward fails (colima logs that as a warning). Claiming the port
 * ourselves first is the only way the collision reaches us.
 */
export async function isHostPortBindable(port: number): Promise<boolean> {
	try {
		// Loopback specifically: it's where code-server is always published, and a wildcard squatter
		// blocks this bind too, so the one probe covers both.
		const server = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } });
		server.stop(true);
		return true;
	} catch {
		return false;
	}
}

/** Takes the probe as a parameter so the scan is testable without binding real sockets. */
export async function pickBindablePort(
	usedSets: ReadonlySet<number>[],
	isBindable: (port: number) => Promise<boolean>
): Promise<number> {
	const rejected = new Set<number>();
	for (;;) {
		const port = pickFreePort([...usedSets, rejected]);
		if (await isBindable(port)) return port;
		rejected.add(port);
	}
}
