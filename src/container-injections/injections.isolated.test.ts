import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { injections, resolveInjections } from '../lib/injections.server.ts';
import { setOption } from '../lib/db.server.ts';
import { attentionHookSettings } from './attention-hooks.ts';
import { isValid } from './claude-code-credentials.ts';
import { customEndpointConfig } from './claude-code-custom.ts';
import { hostEnvVarsConfig, parseHostEnvVarNames } from './host-env-vars.ts';
import { INSTALL_SCRIPT, TMUX_CONF_LINES } from './tmux.ts';

describe('injection registry', () => {
	test('every injection has a unique id', () => {
		const ids = injections.map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('resolveInjections returns unique ids', () => {
		const ids = resolveInjections().map((i) => i.id);
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

	test('host-env-vars is registered with an auth chip and a health check', () => {
		const hostEnvVars = injections.find((i) => i.id === 'host-env-vars');
		expect(hostEnvVars).toBeDefined();
		expect(hostEnvVars!.auth).toBeDefined();
		expect(typeof hostEnvVars!.check).toBe('function');
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

	test('conf binds a key to toggle mouse mode for copy/paste vs. scroll', () => {
		expect(TMUX_CONF_LINES.some((line) => line.startsWith('bind m set -g mouse'))).toBe(true);
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

describe('resolveInjections — custom endpoint toggle', () => {
	beforeEach(() => {
		// Start each test with the feature off and a clean slate.
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	afterEach(() => {
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	test('uses claude-code-credentials when custom endpoint is disabled', () => {
		const ids = resolveInjections().map((i) => i.id);
		expect(ids).toContain('claude-code-credentials');
		expect(ids).not.toContain('claude-code-custom');
	});

	test('uses claude-code-custom when custom endpoint is enabled', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const ids = resolveInjections().map((i) => i.id);
		expect(ids).toContain('claude-code-custom');
		expect(ids).not.toContain('claude-code-credentials');
	});

	test('never includes both Claude injections at once', () => {
		const idsOff = resolveInjections().map((i) => i.id);
		const hasCredentials = idsOff.includes('claude-code-credentials');
		const hasCustom = idsOff.includes('claude-code-custom');
		expect(hasCredentials && hasCustom).toBe(false);

		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const idsOn = resolveInjections().map((i) => i.id);
		const hasCredentialsOn = idsOn.includes('claude-code-credentials');
		const hasCustomOn = idsOn.includes('claude-code-custom');
		expect(hasCredentialsOn && hasCustomOn).toBe(false);
	});
});

describe('customEndpointConfig', () => {
	beforeEach(() => {
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	afterEach(() => {
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	test('returns null when disabled', () => {
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		expect(customEndpointConfig()).toBeNull();
	});

	test('returns null when enabled but base URL is blank', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_token', 'sk-test');
		expect(customEndpointConfig()).toBeNull();
	});

	test('returns null when enabled but token is blank', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		expect(customEndpointConfig()).toBeNull();
	});

	test('returns config when fully configured', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const config = customEndpointConfig();
		expect(config).not.toBeNull();
		expect(config!.baseUrl).toBe('https://litellm.example.com/bedrock');
		expect(config!.token).toBe('sk-test');
	});

	test('falls back to module defaults when model IDs are not set', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const config = customEndpointConfig()!;
		expect(config.opusModel).toBe('eu.anthropic.claude-opus-4-8');
		expect(config.sonnetModel).toBe('eu.anthropic.claude-sonnet-4-6');
		expect(config.defaultModel).toBe('opusplan');
	});

	test('respects custom model overrides', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		setOption('custom_endpoint_opus_model', 'my-custom-opus');
		const config = customEndpointConfig()!;
		expect(config.opusModel).toBe('my-custom-opus');
		setOption('custom_endpoint_opus_model', ''); // cleanup
	});
});

describe('parseHostEnvVarNames', () => {
	test('returns an empty array for null/missing input', () => {
		expect(parseHostEnvVarNames(null)).toEqual([]);
	});

	test('returns an empty array for malformed JSON', () => {
		expect(parseHostEnvVarNames('not json')).toEqual([]);
	});

	test('drops non-string entries', () => {
		expect(parseHostEnvVarNames(JSON.stringify(['FOO', 123, null, 'BAR']))).toEqual(['FOO', 'BAR']);
	});

	test('parses a valid name list', () => {
		expect(parseHostEnvVarNames(JSON.stringify(['FOO', 'BAR']))).toEqual(['FOO', 'BAR']);
	});
});

describe('hostEnvVarsConfig', () => {
	const TEST_VAR = 'CODEBAY_TEST_HOST_ENV_VAR';

	beforeEach(() => {
		setOption('host_env_vars_enabled', '0');
		setOption('host_env_var_names', '[]');
		delete Bun.env[TEST_VAR];
	});

	afterEach(() => {
		setOption('host_env_vars_enabled', '0');
		setOption('host_env_var_names', '[]');
		delete Bun.env[TEST_VAR];
	});

	test('returns null when disabled', () => {
		Bun.env[TEST_VAR] = 'hello';
		setOption('host_env_var_names', JSON.stringify([TEST_VAR]));
		expect(hostEnvVarsConfig()).toBeNull();
	});

	test('returns null when enabled but no names configured', () => {
		setOption('host_env_vars_enabled', '1');
		expect(hostEnvVarsConfig()).toBeNull();
	});

	test('returns null when enabled but none of the configured names resolve on the host', () => {
		setOption('host_env_vars_enabled', '1');
		setOption('host_env_var_names', JSON.stringify([TEST_VAR]));
		expect(hostEnvVarsConfig()).toBeNull();
	});

	test('resolves a configured name that has a host value', () => {
		Bun.env[TEST_VAR] = 'hello';
		setOption('host_env_vars_enabled', '1');
		setOption('host_env_var_names', JSON.stringify([TEST_VAR]));
		const config = hostEnvVarsConfig();
		expect(config).not.toBeNull();
		expect(config!.resolved).toEqual([{ name: TEST_VAR, value: 'hello' }]);
		expect(config!.missing).toEqual([]);
	});

	test('reports unresolved names as missing without dropping resolved ones', () => {
		const missingVar = 'CODEBAY_TEST_MISSING_VAR';
		Bun.env[TEST_VAR] = 'hello';
		delete Bun.env[missingVar];
		setOption('host_env_vars_enabled', '1');
		setOption('host_env_var_names', JSON.stringify([TEST_VAR, missingVar]));
		const config = hostEnvVarsConfig()!;
		expect(config.resolved).toEqual([{ name: TEST_VAR, value: 'hello' }]);
		expect(config.missing).toEqual([missingVar]);
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
