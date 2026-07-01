import { describe, expect, test } from 'bun:test';
import { injections } from '../lib/injections.server.ts';
import { attentionHookSettings } from './attention-hooks.ts';

describe('injection registry', () => {
	test('every injection has a unique id', () => {
		const ids = injections.map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('injections that declare auth provide a hint and status()', () => {
		for (const i of injections) {
			if (!i.auth) continue;
			expect(typeof i.auth.hint).toBe('string');
			expect(typeof i.auth.status).toBe('function');
		}
	});

	test('git-safe-directory applies but reports no health (no check)', () => {
		const git = injections.find((i) => i.id === 'git-safe-directory');
		expect(git).toBeDefined();
		expect(git!.check).toBeUndefined();
	});

	test('git-identity is registered with an auth chip and a health check', () => {
		const identity = injections.find((i) => i.id === 'git-identity');
		expect(identity).toBeDefined();
		expect(identity!.auth).toBeDefined();
		expect(typeof identity!.check).toBe('function');
	});

	test('claude-skip-permissions is registered with a health check', () => {
		const alias = injections.find((i) => i.id === 'claude-skip-permissions');
		expect(alias).toBeDefined();
		expect(typeof alias!.check).toBe('function');
		// No host dependency, so no auth chip.
		expect(alias!.auth).toBeUndefined();
	});
});

describe('attentionHookSettings', () => {
	test('emits valid Claude settings JSON with the three lifecycle hooks', () => {
		const json = attentionHookSettings('inst-123', 'tok-abc');
		const parsed = JSON.parse(json) as { hooks: Record<string, unknown> };
		expect(Object.keys(parsed.hooks).sort()).toEqual(['Notification', 'Stop', 'UserPromptSubmit']);
		// The instance id and token must reach the curl command so the bridge can route + auth it.
		expect(json).toContain('inst-123');
		expect(json).toContain('tok-abc');
	});
});
