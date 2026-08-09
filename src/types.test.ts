import { describe, expect, test } from 'bun:test';
import { isInstanceFilter } from './types.ts';

describe('isInstanceFilter', () => {
	test('accepts the three valid tokens', () => {
		expect(isInstanceFilter('all')).toBe(true);
		expect(isInstanceFilter('active')).toBe(true);
		expect(isInstanceFilter('stopped')).toBe(true);
	});

	test('rejects anything else', () => {
		for (const v of ['', 'ALL', 'running', 'none', null, undefined, 0, {}]) {
			expect(isInstanceFilter(v)).toBe(false);
		}
	});
});
