import { describe, expect, test } from 'bun:test';
import {
	claudePermissionFlags,
	isInstanceFilter,
	normalizeEffortLevel,
	normalizePermissionMode
} from './types.ts';

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

describe('normalizePermissionMode', () => {
	test('keeps the four supported modes', () => {
		for (const mode of ['default', 'manual', 'auto', 'plan'] as const) {
			expect(normalizePermissionMode(mode)).toBe(mode);
		}
	});

	test('falls back to the historical bypass behaviour', () => {
		for (const v of ['', 'PLAN', 'bypassPermissions', null, undefined, 0, {}]) {
			expect(normalizePermissionMode(v)).toBe('default');
		}
	});
});

describe('normalizeEffortLevel', () => {
	test('keeps the five supported levels', () => {
		for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
			expect(normalizeEffortLevel(level)).toBe(level);
		}
	});

	test('falls back to high for anything unrecognised', () => {
		for (const v of ['', 'HIGH', 'ultra', null, undefined, 0, {}]) {
			expect(normalizeEffortLevel(v)).toBe('high');
		}
	});
});

describe('claudePermissionFlags', () => {
	test('default keeps the never-prompt bypass', () => {
		expect(claudePermissionFlags('default')).toBe('--dangerously-skip-permissions');
	});

	// The bypass flag overrides --permission-mode, so an explicit mode must go out alone.
	test('an explicit mode never carries the bypass flag', () => {
		for (const mode of ['manual', 'auto', 'plan'] as const) {
			expect(claudePermissionFlags(mode)).toBe(`--permission-mode ${mode}`);
		}
	});
});
