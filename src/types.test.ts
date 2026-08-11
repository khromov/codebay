import { describe, expect, test } from 'bun:test';
import {
	canCreate,
	claudePermissionFlags,
	isInstanceFilter,
	isSandboxMode,
	normalizeMode,
	normalizePermissionMode,
	usesTerminalUi,
	type Preflight
} from './types.ts';

describe('normalizeMode', () => {
	test('keeps the three supported modes', () => {
		for (const mode of ['ide', 'terminal', 'nono'] as const) {
			expect(normalizeMode(mode)).toBe(mode);
		}
	});

	test('falls back to the full IDE for anything else', () => {
		for (const v of ['', 'NONO', 'sandbox', 'ttyd', null, undefined, 0, {}]) {
			expect(normalizeMode(v)).toBe('ide');
		}
	});
});

describe('mode predicates', () => {
	test('both non-IDE modes render the xterm pane', () => {
		expect(usesTerminalUi('ide')).toBe(false);
		expect(usesTerminalUi('terminal')).toBe(true);
		expect(usesTerminalUi('nono')).toBe(true);
	});

	test('only nono runs outside Docker', () => {
		expect(isSandboxMode('nono')).toBe(true);
		expect(isSandboxMode('terminal')).toBe(false);
		expect(isSandboxMode('ide')).toBe(false);
	});
});

describe('canCreate', () => {
	const preflight = (over: Partial<Preflight>): Preflight => ({
		docker: true,
		cli: true,
		nono: true,
		auth: [],
		defaultMode: 'ide',
		...over
	});

	test('the container modes need both Docker and the CLI', () => {
		expect(canCreate(preflight({ docker: false }), 'ide')).toBe(false);
		expect(canCreate(preflight({ cli: false }), 'terminal')).toBe(false);
		expect(canCreate(preflight({}), 'ide')).toBe(true);
	});

	// The whole point of the mode: a dead daemon must not block it.
	test('sandbox mode needs only nono, never Docker', () => {
		expect(canCreate(preflight({ docker: false, cli: false }), 'nono')).toBe(true);
		expect(canCreate(preflight({ nono: false }), 'nono')).toBe(false);
	});
});

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
