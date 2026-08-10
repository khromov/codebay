import { describe, expect, test } from 'bun:test';
import { PORT_BASE, PORT_MAX } from './config.server.ts';
import { pickBindablePort, pickFreePort } from './ports.server.ts';

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

describe('pickBindablePort', () => {
	// A listener the DB and Docker know nothing about — the case that stranded an instance on a
	// port the VM's forwarder could never bind.
	const squatting = (...ports: number[]) => {
		const held = new Set(ports);
		return async (port: number) => !held.has(port);
	};

	test('returns the first candidate the host can actually bind', async () => {
		expect(await pickBindablePort([], squatting())).toBe(PORT_BASE);
	});

	test('skips a run of ports held outside Docker', async () => {
		const isBindable = squatting(PORT_BASE, PORT_BASE + 1, PORT_BASE + 2);
		expect(await pickBindablePort([], isBindable)).toBe(PORT_BASE + 3);
	});

	test('skips ports the union rejects and ports the host rejects together', async () => {
		const used = new Set([PORT_BASE]);
		expect(await pickBindablePort([used], squatting(PORT_BASE + 1))).toBe(PORT_BASE + 2);
	});

	test('throws once every port is used or unbindable', async () => {
		const all = new Set<number>();
		for (let port = PORT_BASE + 1; port <= PORT_MAX; port++) all.add(port);
		// Only PORT_BASE survives the union, and the host holds it too.
		await expect(pickBindablePort([all], squatting(PORT_BASE))).rejects.toThrow(
			'No free host ports available.'
		);
	});
});
