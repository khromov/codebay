import { describe, expect, test } from 'bun:test';
import { nextProbeDelay } from './health.server.ts';
import type { InstanceHealth } from '../types.ts';

function health(overrides: Partial<InstanceHealth>): InstanceHealth {
	return {
		containerRunning: true,
		codeServerAccessible: false,
		injections: [],
		openPorts: [],
		checkedAt: 0,
		...overrides
	};
}

describe('nextProbeDelay', () => {
	test('probes fast while code-server has never answered', () => {
		expect(nextProbeDelay(health({}), false, 0)).toBe(1000);
		expect(nextProbeDelay(health({}), false, 119_000)).toBe(1000);
	});

	test('drops to the slow cadence once code-server has answered', () => {
		expect(nextProbeDelay(health({ codeServerAccessible: true }), true, 5_000)).toBe(5000);
		// A later outage stays slow — the fast phase is only for first boot, not incident polling.
		expect(nextProbeDelay(health({}), true, 5_000)).toBe(5000);
	});

	test('gives up on the fast cadence after the window cap', () => {
		expect(nextProbeDelay(health({}), false, 120_000)).toBe(5000);
	});

	test('never probes fast while the container is down', () => {
		expect(nextProbeDelay(health({ containerRunning: false }), false, 0)).toBe(5000);
	});
});
