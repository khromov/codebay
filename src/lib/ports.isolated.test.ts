import { describe, expect, test } from 'bun:test';
import { PORT_BASE, PORT_MAX } from './config.server.ts';
import { pickFreePort } from './ports.server.ts';

describe('pickFreePort', () => {
	test('returns PORT_BASE when nothing is in use', () => {
		expect(pickFreePort([])).toBe(PORT_BASE);
	});

	test('skips a port from every supplied set, not just the first', () => {
		// Mirrors allocatePort's DB ∪ Docker ∪ reservations union: a port only Docker
		// reports (e.g. a container the DB lost track of) must still be excluded, exactly
		// like one only the DB or only an in-flight reservation knows about.
		const dbPorts = new Set([PORT_BASE]);
		const dockerOnlyPort = new Set([PORT_BASE + 1]);
		const reserved = new Set([PORT_BASE + 2]);
		expect(pickFreePort([dbPorts, dockerOnlyPort, reserved])).toBe(PORT_BASE + 3);
	});

	test('throws once the whole range is exhausted', () => {
		const all = new Set<number>();
		for (let port = PORT_BASE; port <= PORT_MAX; port++) all.add(port);
		expect(() => pickFreePort([all])).toThrow('No free host ports available.');
	});
});
