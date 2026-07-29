import { PORT_BASE, PORT_MAX } from './config.server.ts';

/** Kept pure so `allocatePort`'s union logic is testable without a DB or Docker daemon. */
export function pickFreePort(usedSets: ReadonlySet<number>[]): number {
	for (let port = PORT_BASE; port <= PORT_MAX; port++) {
		if (usedSets.every((s) => !s.has(port))) return port;
	}
	throw new Error('No free host ports available.');
}
