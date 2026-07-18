import { describe, expect, test } from 'bun:test';
import { injections } from '../lib/injections.server.ts';
import { attentionHookSettings } from './attention-hooks.ts';
import { isValid } from './claude-code-credentials.ts';
import { INSTALL_SCRIPT, TMUX_CONF_LINES } from './tmux.ts';

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

	test('claude-aliases is registered with a health check', () => {
		const aliases = injections.find((i) => i.id === 'claude-aliases');
		expect(aliases).toBeDefined();
		expect(typeof aliases!.check).toBe('function');
		// No host dependency, so no auth chip.
		expect(aliases!.auth).toBeUndefined();
	});

	test('tmux is registered with a health check', () => {
		const t = injections.find((i) => i.id === 'tmux');
		expect(t).toBeDefined();
		expect(typeof t!.check).toBe('function');
		// No host dependency, so no auth chip.
		expect(t!.auth).toBeUndefined();
	});

	test('tmux runs second, right after git-safe-directory', () => {
		// git safe.directory must stay first (later git-touching steps depend on it);
		// tmux is next because its package install is the slowest injection and the
		// Terminal task falls back to non-persistent mode until it lands.
		expect(injections[0]!.id).toBe('git-safe-directory');
		expect(injections[1]!.id).toBe('tmux');
	});
});

describe('tmux injection scripts', () => {
	test('install script short-circuits when tmux is already present', () => {
		expect(INSTALL_SCRIPT.startsWith('if command -v tmux >/dev/null 2>&1; then exit 0; fi;')).toBe(
			true
		);
	});

	test('install script covers the supported package managers', () => {
		for (const pm of ['apt-get', 'apk', 'dnf', 'microdnf', 'yum']) {
			expect(INSTALL_SCRIPT).toContain(pm);
		}
	});

	test('conf enables mouse scrollback and hides the status bar', () => {
		expect(TMUX_CONF_LINES).toContain('set -g mouse on');
		expect(TMUX_CONF_LINES).toContain('set -g status off');
	});
});

describe('attentionHookSettings', () => {
	test('emits valid Claude settings JSON with the three lifecycle hooks', () => {
		const json = attentionHookSettings('inst-123');
		const parsed = JSON.parse(json) as { hooks: Record<string, unknown> };
		expect(Object.keys(parsed.hooks).sort()).toEqual(['Notification', 'Stop', 'UserPromptSubmit']);
		// The instance id must reach the curl command so the bridge can route it.
		expect(json).toContain('inst-123');
		// The token must NOT be baked into settings.json — the hooks read it from a
		// mode-600 header file at runtime, keeping it off curl's argv (and out of ps).
		expect(json).toContain('.bridge-header');
	});
});

describe('claude-code-credentials isValid', () => {
	const oauth = (extra: Record<string, unknown>) =>
		JSON.stringify({ claudeAiOauth: { accessToken: 'tok', ...extra } });

	test('rejects malformed JSON', () => {
		expect(isValid('not json')).toBe(false);
	});

	test('rejects a missing access token', () => {
		expect(isValid(JSON.stringify({ claudeAiOauth: {} }))).toBe(false);
	});

	test('accepts a token with no expiry info at all', () => {
		expect(isValid(oauth({}))).toBe(true);
	});

	test('accepts an access token that has expired, as long as the refresh token has not', () => {
		expect(
			isValid(oauth({ expiresAt: Date.now() - 1000, refreshTokenExpiresAt: Date.now() + 1000 }))
		).toBe(true);
	});

	test('rejects once the refresh token itself has expired', () => {
		expect(
			isValid(oauth({ expiresAt: Date.now() + 1000, refreshTokenExpiresAt: Date.now() - 1000 }))
		).toBe(false);
	});

	test('falls back to the access token expiry when there is no refresh-token expiry', () => {
		expect(isValid(oauth({ expiresAt: Date.now() - 1000 }))).toBe(false);
		expect(isValid(oauth({ expiresAt: Date.now() + 1000 }))).toBe(true);
	});
});
