import { describe, expect, test } from 'bun:test';
import { nextTabIndex } from './tab-nav.ts';

describe('nextTabIndex', () => {
	test('arrows wrap around both ends', () => {
		expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
		expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
		expect(nextTabIndex(2, 'ArrowLeft', 3)).toBe(1);
		expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
	});

	test('Home and End jump to the ends', () => {
		expect(nextTabIndex(1, 'Home', 3)).toBe(0);
		expect(nextTabIndex(1, 'End', 3)).toBe(2);
	});

	test('digits 1-8 are absolute positions', () => {
		expect(nextTabIndex(0, '1', 5)).toBe(0);
		expect(nextTabIndex(0, '3', 5)).toBe(2);
		expect(nextTabIndex(0, '5', 5)).toBe(4);
	});

	test('9 means the last tab, however many there are', () => {
		expect(nextTabIndex(0, '9', 3)).toBe(2);
		expect(nextTabIndex(0, '9', 12)).toBe(11);
	});

	test('a digit past the end is ignored rather than clamped', () => {
		expect(nextTabIndex(0, '5', 3)).toBeNull();
		expect(nextTabIndex(0, '8', 3)).toBeNull();
	});

	test('unhandled keys pass through', () => {
		for (const key of ['ArrowUp', 'Enter', 'a', '0', 'Tab', ' ']) {
			expect(nextTabIndex(0, key, 3)).toBeNull();
		}
	});

	test('an empty strip never resolves', () => {
		for (const key of ['ArrowRight', 'Home', 'End', '1', '9']) {
			expect(nextTabIndex(0, key, 0)).toBeNull();
		}
	});

	test('an out-of-range current index still resolves', () => {
		expect(nextTabIndex(-1, 'ArrowRight', 3)).toBe(1);
		expect(nextTabIndex(99, 'ArrowLeft', 3)).toBe(2);
	});
});
