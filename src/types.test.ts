import { describe, expect, test } from 'bun:test';
import {
	claudePermissionFlags,
	isInstanceFilter,
	isTheme,
	normalizeEffortSetting,
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

describe('isTheme', () => {
	test('accepts the three valid tokens', () => {
		expect(isTheme('light')).toBe(true);
		expect(isTheme('dark')).toBe(true);
		expect(isTheme('auto')).toBe(true);
	});

	test('rejects anything else', () => {
		for (const v of ['', 'DARK', 'system', null, undefined, 0, {}]) {
			expect(isTheme(v)).toBe(false);
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

describe('normalizeEffortSetting', () => {
	test('keeps the five supported levels and the inherit choice', () => {
		for (const level of ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
			expect(normalizeEffortSetting(level)).toBe(level);
		}
	});

	test('inherits the host for anything unrecognised, including an unset option', () => {
		for (const v of ['', 'HIGH', 'ultra', null, undefined, 0, {}]) {
			expect(normalizeEffortSetting(v)).toBe('default');
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
