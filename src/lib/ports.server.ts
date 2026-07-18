import { PORT_BASE, PORT_MAX } from './config.server.ts';

/**
 * Pick the lowest port in [PORT_BASE, PORT_MAX] absent from every set in `usedSets`.
 * Pure and side-effect free so `allocatePort`'s union logic (DB rows ∪ live Docker
 * bindings ∪ in-flight reservations) is unit-testable without a live DB or Docker
 * daemon — see ports.isolated.test.ts.
 */
export function pickFreePort(usedSets: ReadonlySet<number>[]): number {
	for (let port = PORT_BASE; port <= PORT_MAX; port++) {
		if (usedSets.every((s) => !s.has(port))) return port;
	}
	throw new Error('No free host ports available.');
}
