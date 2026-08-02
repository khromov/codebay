import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injections, resolveInjections } from '../lib/injections.server.ts';
import { setOption } from '../lib/db.server.ts';
import { attentionHookSettings, hasAttentionHook } from './attention-hooks.ts';
import { isValid, LIVE_CREDENTIALS_TEST, tokenCredentials } from './claude-code-credentials.ts';
import { customEndpointConfig } from './claude-code-custom.ts';
import { gitIdentity, gitIdentityEnabled, readGitIdentity } from './git-identity.ts';
import { manualModelConfig } from './claude-code-models.ts';
import { ghHostBlock, parseGhHosts } from './github-credentials.ts';
import { hostEnvVarPresence, hostEnvVarsConfig, parseHostEnvVarNames } from './host-env-vars.ts';
import { expandTilde, extractScriptPath } from './claude-statusline.ts';
import { hostClaudeModel } from './claude-model.ts';
import { NO_COAUTHOR_SETTINGS } from './claude-no-coauthor.ts';
import { claudeTrustConfig } from './claude-trust.ts';
import { homedir } from 'node:os';
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
		expect(alias!.auth).toBeUndefined();
	});

	test('claude-aliases is registered with a health check', () => {
		const aliases = injections.find((i) => i.id === 'claude-aliases');
		expect(aliases).toBeDefined();
		expect(typeof aliases!.check).toBe('function');
		expect(aliases!.auth).toBeUndefined();
	});

	test('claude-no-coauthor is registered with a health check', () => {
		const noCoauthor = injections.find((i) => i.id === 'claude-no-coauthor');
		expect(noCoauthor).toBeDefined();
		expect(typeof noCoauthor!.check).toBe('function');
		expect(noCoauthor!.auth).toBeUndefined();
	});

	test('claude-trust is registered with a health check', () => {
		const trust = injections.find((i) => i.id === 'claude-trust');
		expect(trust).toBeDefined();
		expect(typeof trust!.check).toBe('function');
		expect(trust!.auth).toBeUndefined();
	});

	test('claude-statusline is registered with an auth chip and a health check', () => {
		const statusline = injections.find((i) => i.id === 'claude-statusline');
		expect(statusline).toBeDefined();
		expect(statusline!.auth).toBeDefined();
		expect(typeof statusline!.check).toBe('function');
	});

	test('claude-model is registered with an auth chip and a health check', () => {
		const model = injections.find((i) => i.id === 'claude-model');
		expect(model).toBeDefined();
		expect(model!.auth).toBeDefined();
		expect(typeof model!.check).toBe('function');
	});

	test('host-env-vars is registered with a health check and no auth chip', () => {
		const hostEnvVars = injections.find((i) => i.id === 'host-env-vars');
		expect(hostEnvVars).toBeDefined();
		expect(typeof hostEnvVars!.check).toBe('function');
		// Opt-in convenience feature, not a discovered host credential — omitting
		// `auth` keeps it out of the global credentials chip when unconfigured.
		expect(hostEnvVars!.auth).toBeUndefined();
	});

	test('tmux is registered with a health check', () => {
		const t = injections.find((i) => i.id === 'tmux');
		expect(t).toBeDefined();
		expect(typeof t!.check).toBe('function');
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
	test('emits a Claude settings object with the three lifecycle hooks', () => {
		const settings = attentionHookSettings('inst-123');
		const hooks = settings.hooks as Record<string, unknown>;
		expect(Object.keys(hooks).sort()).toEqual(['Notification', 'Stop', 'UserPromptSubmit']);
		const json = JSON.stringify(settings);
		// The instance id must reach the curl command so the bridge can route it.
		expect(json).toContain('inst-123');
		// The token must NOT be baked into settings.json — the hooks read it from a
		// mode-600 header file at runtime, keeping it off curl's argv (and out of ps).
		expect(json).toContain('.bridge-header');
	});
});

describe('hasAttentionHook', () => {
	test('matches settings carrying the instance hooks', () => {
		expect(hasAttentionHook(attentionHookSettings('inst-abc'), 'inst-abc')).toBe(true);
	});

	test('rejects a different instance id, empty settings, and null', () => {
		expect(hasAttentionHook(attentionHookSettings('inst-abc'), 'inst-xyz')).toBe(false);
		expect(hasAttentionHook({}, 'inst-abc')).toBe(false);
		expect(hasAttentionHook(null, 'inst-abc')).toBe(false);
	});

	test('an id that is a prefix of the installed one does not match', () => {
		expect(hasAttentionHook(attentionHookSettings('inst-abcdef'), 'inst-abc')).toBe(false);
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

describe('git identity override', () => {
	beforeEach(() => {
		setOption('git_identity_enabled', '');
		setOption('git_identity_name', '');
		setOption('git_identity_email', '');
	});

	afterEach(() => {
		setOption('git_identity_enabled', '');
		setOption('git_identity_name', '');
		setOption('git_identity_email', '');
	});

	test('wins over host git config when both name and email are set', async () => {
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		const identity = await readGitIdentity();
		expect(identity).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
	});

	test('an explicit off toggle falls back to the host even with both fields set', async () => {
		setOption('git_identity_enabled', '0');
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		expect(gitIdentityEnabled()).toBe(false);
		const identity = await readGitIdentity();
		expect(identity?.name).not.toBe('Jane Doe');
	});

	test('the toggle defaults on when both fields are already filled', () => {
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		expect(gitIdentityEnabled()).toBe(true);
	});

	test('a lone name with no email is not treated as an override', async () => {
		setOption('git_identity_name', 'Jane Doe');
		const identity = await readGitIdentity();
		expect(identity?.name).not.toBe('Jane Doe');
	});

	test('a lone email with no name is not treated as an override', async () => {
		setOption('git_identity_email', 'jane@example.com');
		const identity = await readGitIdentity();
		expect(identity?.email).not.toBe('jane@example.com');
	});

	test('blank strings are treated the same as unset', async () => {
		setOption('git_identity_name', '  ');
		setOption('git_identity_email', '  ');
		const identity = await readGitIdentity();
		expect(identity?.name).not.toBe('  ');
	});

	test('auth.status() reports the Settings override as the source', async () => {
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		const status = await gitIdentity.auth!.status();
		expect(status).toEqual({ available: true, source: 'Settings override — Jane Doe' });
	});
});

describe('manualModelConfig', () => {
	const MODEL_KEYS = [
		'manual_opus_model',
		'manual_sonnet_model',
		'manual_haiku_model',
		'manual_small_fast_model',
		'manual_model'
	];
	function reset() {
		setOption('manual_model_override_enabled', '0');
		setOption('custom_endpoint_enabled', '0');
		for (const k of MODEL_KEYS) setOption(k, '');
	}
	beforeEach(reset);
	afterEach(reset);

	test('returns null when the override is disabled', () => {
		setOption('manual_model', 'opus');
		expect(manualModelConfig()).toBeNull();
	});

	test('returns null when LiteLLM is enabled (mutually exclusive)', () => {
		setOption('manual_model_override_enabled', '1');
		setOption('custom_endpoint_enabled', '1');
		setOption('manual_model', 'opus');
		expect(manualModelConfig()).toBeNull();
	});

	test('returns null when enabled but every field is blank', () => {
		setOption('manual_model_override_enabled', '1');
		expect(manualModelConfig()).toBeNull();
	});

	test('exports only the filled fields, mapped to their env vars', () => {
		setOption('manual_model_override_enabled', '1');
		setOption('manual_model', 'opusplan');
		setOption('manual_small_fast_model', 'haiku');
		expect(manualModelConfig()).toEqual({
			ANTHROPIC_MODEL: 'opusplan',
			ANTHROPIC_SMALL_FAST_MODEL: 'haiku'
		});
	});

	test('maps all five tiers when fully filled', () => {
		setOption('manual_model_override_enabled', '1');
		setOption('manual_opus_model', 'o');
		setOption('manual_sonnet_model', 's');
		setOption('manual_haiku_model', 'h');
		setOption('manual_small_fast_model', 'sf');
		setOption('manual_model', 'd');
		expect(manualModelConfig()).toEqual({
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'o',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 's',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'h',
			ANTHROPIC_SMALL_FAST_MODEL: 'sf',
			ANTHROPIC_MODEL: 'd'
		});
	});
});

describe('hostClaudeModel', () => {
	function reset() {
		setOption('manual_model_override_enabled', '0');
		setOption('custom_endpoint_enabled', '0');
	}
	beforeEach(reset);
	afterEach(reset);

	test('is null when the manual model override owns the model', async () => {
		setOption('manual_model_override_enabled', '1');
		expect(await hostClaudeModel()).toBeNull();
	});

	test('is null when LiteLLM owns the model', async () => {
		setOption('custom_endpoint_enabled', '1');
		expect(await hostClaudeModel()).toBeNull();
	});
});

describe('NO_COAUTHOR_SETTINGS', () => {
	test('suppresses the byline via both the root and nested attribution schemas', () => {
		expect(NO_COAUTHOR_SETTINGS.includeCoAuthoredBy).toBe(false);
		expect(NO_COAUTHOR_SETTINGS.attribution).toEqual({
			commit: '',
			pr: '',
			includeCoAuthoredBy: false
		});
	});
});

describe('claudeTrustConfig', () => {
	test('always pre-accepts onboarding and the bypass-permissions warning at root', () => {
		const cfg = claudeTrustConfig(null);
		expect(cfg.hasCompletedOnboarding).toBe(true);
		expect(cfg.bypassPermissionsModeAccepted).toBe(true);
	});

	test('omits the projects block when no workspace path is known', () => {
		expect(claudeTrustConfig(null).projects).toBeUndefined();
	});

	test('nests trust + MCP auto-accept under the workspace path', () => {
		const cfg = claudeTrustConfig('/workspaces/my-repo');
		expect(cfg.projects).toEqual({
			'/workspaces/my-repo': {
				hasTrustDialogAccepted: true,
				hasCompletedProjectOnboarding: true,
				enableAllProjectMcpServers: true
			}
		});
	});
});

describe('claude-code-models registry', () => {
	test('is present regardless of the custom-endpoint toggle (self-guards at apply time)', () => {
		setOption('custom_endpoint_enabled', '0');
		expect(resolveInjections().map((i) => i.id)).toContain('claude-code-models');
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		expect(resolveInjections().map((i) => i.id)).toContain('claude-code-models');
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	test('carries no auth chip and no health check', () => {
		const models = injections.find((i) => i.id === 'claude-code-models');
		expect(models).toBeDefined();
		expect(models!.auth).toBeUndefined();
		expect(models!.check).toBeUndefined();
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

describe('hostEnvVarPresence', () => {
	const TEST_VAR = 'CODEBAY_TEST_PRESENCE_VAR';

	afterEach(() => {
		delete Bun.env[TEST_VAR];
	});

	test('marks a name present when its host value is non-empty', () => {
		Bun.env[TEST_VAR] = 'hello';
		expect(hostEnvVarPresence([TEST_VAR])).toEqual({ [TEST_VAR]: true });
	});

	test('marks a name absent when unset', () => {
		delete Bun.env[TEST_VAR];
		expect(hostEnvVarPresence([TEST_VAR])).toEqual({ [TEST_VAR]: false });
	});

	test('returns one entry per requested name', () => {
		const missingVar = 'CODEBAY_TEST_PRESENCE_MISSING';
		Bun.env[TEST_VAR] = 'hello';
		expect(hostEnvVarPresence([TEST_VAR, missingVar])).toEqual({
			[TEST_VAR]: true,
			[missingVar]: false
		});
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

describe('parseGhHosts', () => {
	test('returns an empty array when hosts.yml is empty', () => {
		expect(parseGhHosts('')).toEqual([]);
	});

	test('parses a single host', () => {
		const raw = 'github.com:\n    oauth_token: gho_abc\n    git_protocol: https\n';
		expect(parseGhHosts(raw)).toEqual(['github.com']);
	});

	test('parses multiple hosts, including a GitHub Enterprise host', () => {
		const raw =
			'github.com:\n    oauth_token: gho_abc\n    git_protocol: https\n' +
			'schibsted.ghe.com:\n    oauth_token: gho_def\n    git_protocol: https\n    user: stanislav-khromov\n';
		expect(parseGhHosts(raw)).toEqual(['github.com', 'schibsted.ghe.com']);
	});

	test('does not mistake an indented key for a host', () => {
		const raw = 'github.com:\n    oauth_token: gho_abc\n';
		expect(parseGhHosts(raw)).toEqual(['github.com']);
	});
});

describe('ghHostBlock', () => {
	const raw =
		'github.com:\n    oauth_token: gho_abc\n    git_protocol: https\n    user: khromov\n' +
		'schibsted.ghe.com:\n    oauth_token: gho_def\n    git_protocol: ssh\n    user: stanislav-khromov\n';

	test('returns null for a host not present', () => {
		expect(ghHostBlock(raw, 'gitlab.example.com')).toBeNull();
	});

	test('extracts only the requested host block, not the next host', () => {
		const block = ghHostBlock(raw, 'github.com')!;
		expect(block).toContain('oauth_token: gho_abc');
		expect(block).toContain('user: khromov');
		expect(block).not.toContain('gho_def');
		expect(block).not.toContain('schibsted.ghe.com');
	});

	test('extracts the last host block through end of file', () => {
		const block = ghHostBlock(raw, 'schibsted.ghe.com')!;
		expect(block).toContain('oauth_token: gho_def');
		expect(block).toContain('git_protocol: ssh');
	});
});

describe('expandTilde', () => {
	test('expands a leading ~/ against the home directory', () => {
		expect(expandTilde('~/statusline.sh')).toBe(join(homedir(), 'statusline.sh'));
	});

	test('leaves absolute and non-tilde paths untouched', () => {
		expect(expandTilde('/abs/path')).toBe('/abs/path');
		expect(expandTilde('relative/path')).toBe('relative/path');
	});
});

describe('extractScriptPath', () => {
	test('returns null for a bare package-runner command with no file reference', () => {
		expect(extractScriptPath('npx ccstatusline@latest')).toBeNull();
	});

	test('returns null when the referenced path does not exist on disk', () => {
		expect(extractScriptPath('/no/such/file/statusline.sh')).toBeNull();
	});

	test('finds an existing absolute-path token amid other arguments', () => {
		// Use a file guaranteed to exist without depending on codebay-specific state.
		expect(extractScriptPath(`bash ${import.meta.path} --flag`)).toBe(import.meta.path);
	});

	// jq's `//` operator and a bare `/` resolve to the root dir with existsSync — but they're
	// not files, so an inline command must not be mistaken for a script-file reference.
	test('ignores jq operators and division in an inline command', () => {
		const inline =
			`input=$(cat); model=$(echo "$input" | jq -r '.model.display_name // "Unknown model"'); ` +
			`cost=$(echo "$input" | jq -r '(.cost.total_cost_usd // 0) | . * 100 | round / 100')`;
		expect(extractScriptPath(inline)).toBeNull();
	});

	test('ignores a root or directory token that is not a regular file', () => {
		expect(extractScriptPath('cat / done')).toBeNull();
		expect(extractScriptPath('x // y')).toBeNull();
	});

	test('returns null for a missing ~/ script path', () => {
		expect(extractScriptPath('~/definitely-missing-xyz.sh')).toBeNull();
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

describe('claude-code-credentials tokenCredentials', () => {
	const parse = (json: string) =>
		(JSON.parse(json) as { claudeAiOauth: { accessToken: string; scopes?: string[] } })
			.claudeAiOauth;

	test('carries the token through verbatim', () => {
		expect(parse(tokenCredentials('sk-ant-oat01-abc')).accessToken).toBe('sk-ant-oat01-abc');
	});

	// Without `scopes`, `claude` reports "Not logged in" however valid the token is.
	test('includes scopes, without which claude ignores the credentials', () => {
		const scopes = parse(tokenCredentials('sk-ant-oat01-abc')).scopes;
		expect(scopes).toBeDefined();
		expect(scopes).toContain('user:inference');
	});

	test('produces a record that passes isValid', () => {
		expect(isValid(tokenCredentials('sk-ant-oat01-abc'))).toBe(true);
	});
});

describe('claude-code-credentials LIVE_CREDENTIALS_TEST', () => {
	/** Run the injection's own shell predicate against a file, exactly as `check()` does. */
	function isLive(content: string | null): boolean {
		const dir = mkdtempSync(join(tmpdir(), 'codebay-creds-'));
		const file = join(dir, '.credentials.json');
		if (content !== null) writeFileSync(file, content);
		try {
			const res = Bun.spawnSync([
				'bash',
				'-c',
				`f="$1"; if ${LIVE_CREDENTIALS_TEST}; then echo 1; else echo 0; fi`,
				'bash',
				file
			]);
			return res.stdout.toString().trim() === '1';
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	/** The shape `claude` writes; blank tokens are what a rejected refresh leaves behind. */
	const credsFile = (accessToken: string, spaced = false) =>
		JSON.stringify(
			{
				claudeAiOauth: {
					accessToken,
					refreshToken: accessToken ? 'refresh' : '',
					expiresAt: accessToken ? Date.now() + 1000 : 0,
					scopes: ['user:inference'],
					subscriptionType: 'max'
				}
			},
			null,
			spaced ? 2 : undefined
		);

	test('accepts a file carrying a real access token', () => {
		expect(isLive(credsFile('sk-ant-oat-abc'))).toBe(true);
	});

	test('rejects the blanked file a rejected in-container refresh leaves behind', () => {
		expect(isLive(credsFile(''))).toBe(false);
	});

	test('rejects a missing or empty file', () => {
		expect(isLive(null)).toBe(false);
		expect(isLive('')).toBe(false);
	});

	test('reads the same either way when the file is pretty-printed', () => {
		expect(isLive(credsFile('sk-ant-oat-abc', true))).toBe(true);
		expect(isLive(credsFile('', true))).toBe(false);
	});

	test('is unfazed by tabs and CRLF line endings', () => {
		const crlf = (s: string) => s.replace(/\n/g, '\r\n').replace(/ {2}/g, '\t');
		expect(isLive(crlf(credsFile('sk-ant-oat-abc', true)))).toBe(true);
		expect(isLive(crlf(credsFile('', true)))).toBe(false);
	});

	// Ties the two halves together: whatever `tokenCredentials` injects must be what
	// the health check then reports as a live login, or a fresh container reads red.
	test('accepts the record tokenCredentials injects', () => {
		expect(isLive(tokenCredentials('sk-ant-oat01-abc'))).toBe(true);
	});
});
