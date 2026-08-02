import { describe, test, expect } from 'bun:test';
import { nextValue } from './editor.ts';
import { ON, OFF, GRAY } from './types.ts';

describe('nextValue', () => {
	test('black toggles off↔on and never yields gray', () => {
		expect(nextValue('black', OFF)).toBe(ON);
		expect(nextValue('black', ON)).toBe(OFF);
		// A gray cell (e.g. left over from another mode) reads as "not on", so it lights.
		expect(nextValue('black', GRAY)).toBe(ON);
	});

	test('gray toggles off↔gray and never yields on', () => {
		expect(nextValue('gray', OFF)).toBe(GRAY);
		expect(nextValue('gray', GRAY)).toBe(OFF);
		expect(nextValue('gray', ON)).toBe(GRAY);
	});

	test('cycle steps off→gray→on→off', () => {
		expect(nextValue('cycle', OFF)).toBe(GRAY);
		expect(nextValue('cycle', GRAY)).toBe(ON);
		expect(nextValue('cycle', ON)).toBe(OFF);
	});
});
