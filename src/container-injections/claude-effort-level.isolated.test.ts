import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../lib/config.server.ts';
import { setOption } from '../lib/db.server.ts';
import {
	MODEL_FAMILY_ALIASES,
	defaultRunEffort,
	describeDefaultEffort,
	effortSettingsPatch,
	hostEffortFrom,
	uniformEffort
} from './claude-effort-level.ts';

/** The maintainer's host settings from the bug report: every level is xhigh, set both ways. */
const MAINTAINER_HOST = {
	effortLevel: 'xhigh',
	modelSettings: {
		'claude-fable-5-1': { effortLevel: 'xhigh' },
		'claude-opus-5': { effortLevel: 'xhigh' },
		'claude-opus-5-5': { effortLevel: 'xhigh' },
		'claude-fable-5-2': { effortLevel: 'xhigh' }
	}
};

const hostDir = join(DATA_DIR, 'effort-host-claude');

function writeHost(settings: unknown): void {
	mkdirSync(hostDir, { recursive: true });
	writeFileSync(join(hostDir, 'settings.json'), JSON.stringify(settings));
}

beforeEach(() => {
	rmSync(hostDir, { recursive: true, force: true });
	setOption('claude_config_dir', hostDir);
});
afterEach(() => {
	setOption('claude_config_dir', '');
	setOption('claude_effort_level', '');
});

describe('hostEffortFrom', () => {
	test('reads the top-level level and the per-model table /effort writes', () => {
		expect(hostEffortFrom(MAINTAINER_HOST)).toEqual({
			top: 'xhigh',
			perModel: {
				'claude-fable-5-1': 'xhigh',
				'claude-opus-5': 'xhigh',
				'claude-opus-5-5': 'xhigh',
				'claude-fable-5-2': 'xhigh'
			}
		});
	});

	test('ignores junk levels and entries that only carry other per-model keys', () => {
		expect(
			hostEffortFrom({
				effortLevel: 'ultra',
				modelSettings: { a: { autoCompactWindow: 1 }, b: null, c: { effortLevel: 'low' } }
			})
		).toEqual({ top: null, perModel: { c: 'low' } });
		expect(hostEffortFrom(null)).toEqual({ top: null, perModel: {} });
	});
});

describe('effortSettingsPatch', () => {
	test('inheriting writes the per-model entries current Claude Code actually reads', () => {
		const patch = effortSettingsPatch('default', hostEffortFrom(MAINTAINER_HOST), []);
		expect(patch.effortLevel).toBe('xhigh');
		// The bug: only the top-level key was written, which Claude Code 2.1 ignores for current models.
		expect(patch.modelSettings?.['claude-opus-5-5']).toEqual({ effortLevel: 'xhigh' });
		for (const alias of MODEL_FAMILY_ALIASES) {
			expect(patch.modelSettings?.[alias]).toEqual({ effortLevel: 'xhigh' });
		}
	});

	test('inheriting keeps a host level that differs per model', () => {
		const host = hostEffortFrom({
			effortLevel: 'high',
			modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } }
		});
		const patch = effortSettingsPatch('default', host, []);
		expect(patch.modelSettings?.['claude-sonnet-5-5']).toEqual({ effortLevel: 'low' });
		expect(patch.modelSettings?.opus).toEqual({ effortLevel: 'high' });
	});

	test('inheriting from a host that sets nothing writes nothing', () => {
		expect(effortSettingsPatch('default', hostEffortFrom({}), [])).toEqual({});
	});

	test('a fixed level covers the aliases, the host’s models and the configured ids', () => {
		const host = hostEffortFrom({ modelSettings: { 'claude-opus-5': { effortLevel: 'low' } } });
		const patch = effortSettingsPatch('high', host, ['eu.anthropic.claude-opus-4-6-v1']);
		expect(patch.effortLevel).toBe('high');
		for (const key of [
			...MODEL_FAMILY_ALIASES,
			'claude-opus-5',
			'eu.anthropic.claude-opus-4-6-v1'
		]) {
			expect(patch.modelSettings?.[key]).toEqual({ effortLevel: 'high' });
		}
	});

	test('max is never written, since Claude Code drops it from settings.json', () => {
		expect(effortSettingsPatch('max', hostEffortFrom({}), [])).toEqual({});
	});
});

describe('uniformEffort', () => {
	test('a fixed setting is its own default', () => {
		expect(uniformEffort('low', hostEffortFrom(MAINTAINER_HOST))).toBe('low');
	});

	test('inherits a host level that every entry agrees on', () => {
		expect(uniformEffort('default', hostEffortFrom(MAINTAINER_HOST))).toBe('xhigh');
	});

	test('defers to the container when the host’s levels differ per model', () => {
		const host = hostEffortFrom({
			effortLevel: 'xhigh',
			modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } }
		});
		expect(uniformEffort('default', host)).toBeNull();
	});
});

describe('the live default', () => {
	test('an unset option inherits the host’s xhigh', () => {
		writeHost(MAINTAINER_HOST);
		expect(defaultRunEffort()).toBe('xhigh');
		expect(describeDefaultEffort()).toBe("xhigh, inherited from the host's Claude Code settings");
	});

	test('a Codebay setting wins over the host', () => {
		writeHost(MAINTAINER_HOST);
		setOption('claude_effort_level', 'low');
		expect(defaultRunEffort()).toBe('low');
		expect(describeDefaultEffort()).toBe("low, set in Codebay's settings");
	});

	test('names per-model host levels instead of picking one', () => {
		writeHost({
			modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' }, x: { effortLevel: 'low' } }
		});
		expect(defaultRunEffort()).toBeNull();
		expect(describeDefaultEffort()).toContain('claude-opus-5-5: xhigh, x: low');
	});

	test('says so when nobody sets a level', () => {
		expect(defaultRunEffort()).toBeNull();
		expect(describeDefaultEffort()).toContain("Claude Code's own per-model default");
	});
});
