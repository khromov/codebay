import { describe, expect, test } from 'bun:test';
import {
	canCreate,
	claudePermissionFlags,
	isInstanceFilter,
	isSandboxMode,
	normalizeMode,
	normalizePermissionMode,
	parseEnabledModes,
	resolveSecondaryMode,
	SECONDARY_MODE_NONE,
	serializeEnabledModes,
	usesTerminalUi,
	type InstanceMode,
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
		secondaryMode: null,
		enabledModes: ['ide', 'terminal', 'nono'],
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

describe('parseEnabledModes', () => {
	// Existing installs have no stored value and must keep every mode after an update.
	test('unset means all three', () => {
		for (const v of [null, undefined, '', '   ']) {
			expect(parseEnabledModes(v)).toEqual(['ide', 'terminal', 'nono']);
		}
	});

	test('keeps only recognised modes, in canonical order', () => {
		expect(parseEnabledModes('nono,ide')).toEqual(['ide', 'nono']);
		expect(parseEnabledModes(' terminal , bogus ')).toEqual(['terminal']);
	});

	// Otherwise a stale or corrupt value would leave no way to create anything at all.
	test('falls back to all when nothing recognisable survives', () => {
		expect(parseEnabledModes('bogus,nonsense')).toEqual(['ide', 'terminal', 'nono']);
	});

	test('round-trips through serializeEnabledModes', () => {
		const modes: InstanceMode[] = ['ide', 'nono'];
		expect(parseEnabledModes(serializeEnabledModes(modes))).toEqual(modes);
	});
});

describe('resolveSecondaryMode', () => {
	const all: InstanceMode[] = ['ide', 'terminal', 'nono'];

	// Preserves what existing installs had before the button became configurable.
	test('unset picks the first enabled mode that is not the primary', () => {
		expect(resolveSecondaryMode(null, 'ide', all)).toBe('terminal');
		expect(resolveSecondaryMode(undefined, 'terminal', all)).toBe('ide');
	});

	test('honours an explicit choice', () => {
		expect(resolveSecondaryMode('nono', 'ide', all)).toBe('nono');
	});

	test("'none' hides the button", () => {
		expect(resolveSecondaryMode(SECONDARY_MODE_NONE, 'ide', all)).toBeNull();
	});

	// Two buttons doing the same thing is noise, so the shortcut drops out instead.
	test('never duplicates the primary', () => {
		expect(resolveSecondaryMode('ide', 'ide', all)).toBeNull();
	});

	test('drops a choice that has since been disabled', () => {
		expect(resolveSecondaryMode('nono', 'ide', ['ide', 'terminal'])).toBeNull();
	});

	test('returns null when only one mode is enabled', () => {
		expect(resolveSecondaryMode(null, 'ide', ['ide'])).toBeNull();
	});
});
