import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOption, setOption } from '../lib/db.server.ts';
import { routes } from '../routes.ts';
import { resolveInjections, resolveInjectionStages } from '../lib/injections.server.ts';
import {
	antigravityEnabled,
	getDefaultAgent,
	storedDefaultAgent
} from '../lib/host-antigravity.server.ts';
import {
	launchAntigravity,
	SOURCE_INJECTED_ENV,
	writeOverrideConfig
} from '../lib/devcontainer.server.ts';
import { invalidateSecretValues, redactSecrets } from '../lib/instances.server.ts';
import { INSTALL_SCRIPT as AGY_INSTALL_SCRIPT } from './antigravity-install.ts';
import { ANTIGRAVITY_ONBOARDING_FILE } from '../lib/antigravity-settings.server.ts';
import {
	antigravityEnvFileContent,
	decodeKeychainSecret,
	ENV_FILE_NAME as AGY_ENV_FILE,
	isValidOAuthToken,
	LIVE_CREDENTIALS_CHECK,
	locateAntigravityCredentials
} from './antigravity-credentials.ts';
import {
	antigravityAliasLine,
	antigravityConfigEnvContent,
	antigravityPermissionSettings,
	antigravitySettingsPatch,
	EFFORT_ENV_VAR,
	hostAntigravityConfigFrom,
	MODEL_ENV_VAR
} from './antigravity-config.ts';
import {
	antigravityAttentionHooksConfig,
	hasAntigravityAttentionHook
} from './antigravity-attention-hooks.ts';

const POSIX_SHELL_ONLY = process.platform === 'win32';

afterEach(() => {
	setOption('antigravity_enabled', '0');
	setOption('default_agent', 'claude');
	setOption('antigravity_permission_mode', 'default');
	setOption('antigravity_effort_level', 'default');
	setOption('antigravity_model', '');
	setOption('antigravity_config_dir', '');
	setOption('antigravity_gemini_api_key', '');
	setOption('antigravity_gemini_base_url', '');
	invalidateSecretValues();
});

describe('Antigravity opt-in gating', () => {
	test('is off by default and keeps Antigravity out of the injection registry', () => {
		expect(antigravityEnabled()).toBe(false);
		expect(getDefaultAgent()).toBe('claude');
		const ids = resolveInjections().map((i) => i.id);
		expect(ids.filter((id) => id.startsWith('antigravity-'))).toEqual([]);
	});

	test('getDefaultAgent stays claude while Antigravity is disabled even if default_agent is saved', () => {
		setOption('default_agent', 'antigravity');
		expect(getDefaultAgent()).toBe('claude');

		setOption('antigravity_enabled', '1');
		expect(getDefaultAgent()).toBe('antigravity');
	});

	test('enabling Antigravity registers all four injections ahead of shell-path', () => {
		setOption('antigravity_enabled', '1');
		const stages = resolveInjectionStages();
		const stageOf = new Map<string, number>();
		stages.forEach((stage, n) => stage.forEach((i) => stageOf.set(i.id, n)));

		expect(stageOf.has('antigravity-attention-hooks')).toBe(true);
		expect(stageOf.get('antigravity-install')!).toBeLessThan(
			stageOf.get('antigravity-credentials')!
		);
		expect(stageOf.get('antigravity-credentials')!).toBeLessThan(
			stageOf.get('antigravity-config')!
		);
		expect(stageOf.get('antigravity-config')!).toBeLessThan(stageOf.get('shell-path')!);

		// Only the credentials injection draws a CredMenu auth chip.
		const agy = resolveInjections().filter((i) => i.id.startsWith('antigravity-'));
		expect(agy.filter((i) => i.auth).map((i) => i.id)).toEqual(['antigravity-credentials']);
	});
});

describe('Antigravity credential helpers', () => {
	const sampleToken = JSON.stringify({
		token: {
			access_token: 'ya29.access',
			refresh_token: '1//refresh',
			token_type: 'Bearer',
			expiry: '2020-01-01T00:00:00Z'
		},
		user_tier: 'pro'
	});

	test('decodeKeychainSecret handles plain, go-keyring-base64, hex JSON, and hex go-keyring-base64', () => {
		const b64Wrapped = `go-keyring-base64:${Buffer.from(sampleToken, 'utf8').toString('base64')}`;
		const hexPlain = Buffer.from(`${sampleToken}\n`, 'utf8').toString('hex');
		const hexWrapped = Buffer.from(b64Wrapped, 'utf8').toString('hex');

		expect(decodeKeychainSecret(sampleToken)).toBe(sampleToken);
		expect(decodeKeychainSecret(b64Wrapped)).toBe(sampleToken);
		expect(decodeKeychainSecret(hexPlain)).toBe(sampleToken);
		expect(decodeKeychainSecret(hexWrapped)).toBe(sampleToken);
	});

	test('onboarding state targets the cache/ file agy actually reads', () => {
		expect(ANTIGRAVITY_ONBOARDING_FILE.dir).toBe('$h/.gemini/antigravity-cli/cache');
		expect(ANTIGRAVITY_ONBOARDING_FILE.name).toBe('onboarding.json');
	});

	test('isValidOAuthToken accepts StoredToken, legacy flat token, and refreshable expired tokens', () => {
		expect(isValidOAuthToken(sampleToken)).toBe(true);
		expect(isValidOAuthToken(JSON.stringify({ access_token: 'tok' }))).toBe(true);
		// Expired access token with no refresh token is rejected.
		expect(
			isValidOAuthToken(
				JSON.stringify({ token: { access_token: 'tok', expiry: '2020-01-01T00:00:00Z' } })
			)
		).toBe(false);
		expect(isValidOAuthToken('{}')).toBe(false);
		expect(isValidOAuthToken('not json')).toBe(false);
	});

	test('locateAntigravityCredentials respects Settings > CODEBAY env > host gemini mode > OAuth > fallback env', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'codebay-agy-cred-'));
		const tokenPath = join(dir, 'antigravity-oauth-token');
		writeFileSync(tokenPath, sampleToken);
		const encodedKeychain = Buffer.from(
			`go-keyring-base64:${Buffer.from(sampleToken, 'utf8').toString('base64')}`,
			'utf8'
		).toString('hex');

		try {
			// 1. Settings Gemini API key wins over everything.
			setOption('antigravity_gemini_api_key', 'AIza-settings-key');
			setOption('antigravity_gemini_base_url', 'https://proxy.example/gemini');
			const fromSettings = await locateAntigravityCredentials({
				platform: 'darwin',
				env: { GEMINI_API_KEY: 'AIza-env-key' },
				codebayGeminiApiKey: 'AIza-codebay-key',
				readKeychain: async () => encodedKeychain,
				readHostSettings: async () => null,
				tokenFiles: () => [{ path: tokenPath, source: 'test-file' }]
			});
			expect(fromSettings).toEqual({
				kind: 'api-key',
				apiKey: 'AIza-settings-key',
				baseUrl: 'https://proxy.example/gemini',
				source: 'Settings — Gemini API key'
			});

			// Clear Settings key; CODEBAY_GEMINI_API_KEY wins next.
			setOption('antigravity_gemini_api_key', '');
			setOption('antigravity_gemini_base_url', '');
			const fromCodebayEnv = await locateAntigravityCredentials({
				platform: 'darwin',
				env: {},
				codebayGeminiApiKey: 'AIza-codebay-key',
				readKeychain: async () => encodedKeychain,
				readHostSettings: async () => null,
				tokenFiles: () => []
			});
			expect(fromCodebayEnv).toMatchObject({ kind: 'api-key', apiKey: 'AIza-codebay-key' });

			// Host settings with modelProvider: "gemini" + GEMINI_API_KEY wins over OAuth.
			const fromHostGemini = await locateAntigravityCredentials({
				platform: 'darwin',
				env: { GEMINI_API_KEY: 'AIza-host-gemini' },
				codebayGeminiApiKey: '',
				readKeychain: async () => encodedKeychain,
				readHostSettings: async () => ({ modelProvider: 'gemini' }),
				tokenFiles: () => []
			});
			expect(fromHostGemini).toMatchObject({ kind: 'api-key', apiKey: 'AIza-host-gemini' });

			// OAuth keychain beats a stray GEMINI_API_KEY when host modelProvider is not "gemini".
			const fromKeychain = await locateAntigravityCredentials({
				platform: 'darwin',
				env: { GEMINI_API_KEY: 'AIza-unrelated' },
				codebayGeminiApiKey: '',
				readKeychain: async () => encodedKeychain,
				readHostSettings: async () => ({}),
				tokenFiles: () => []
			});
			expect(fromKeychain).toMatchObject({
				kind: 'oauth',
				tokenJson: sampleToken,
				source: expect.stringContaining('macOS Keychain')
			});

			// Token file is picked up when keyring is empty.
			const fromFile = await locateAntigravityCredentials({
				platform: 'linux',
				env: { GEMINI_API_KEY: 'AIza-unrelated' },
				codebayGeminiApiKey: '',
				readKeychain: async () => null,
				readHostSettings: async () => ({}),
				tokenFiles: () => [{ path: tokenPath, source: 'test-file' }]
			});
			expect(fromFile).toEqual({ kind: 'oauth', tokenJson: sampleToken, source: 'test-file' });

			// Fallback to GEMINI_API_KEY env var when no OAuth credentials exist anywhere.
			const fromFallbackEnv = await locateAntigravityCredentials({
				platform: 'linux',
				env: { GEMINI_API_KEY: 'AIza-fallback' },
				codebayGeminiApiKey: '',
				readKeychain: async () => null,
				readHostSettings: async () => null,
				tokenFiles: () => []
			});
			expect(fromFallbackEnv).toMatchObject({ kind: 'api-key', apiKey: 'AIza-fallback' });

			// Returns null when nothing is configured.
			const none = await locateAntigravityCredentials({
				platform: 'linux',
				env: {},
				codebayGeminiApiKey: '',
				readKeychain: async () => null,
				readHostSettings: async () => null,
				tokenFiles: () => []
			});
			expect(none).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('antigravityEnvFileContent exports file storage, auto-update disable, and quoted API key', () => {
		const oauthEnv = antigravityEnvFileContent({
			kind: 'oauth',
			tokenJson: sampleToken,
			source: 'test'
		});
		expect(oauthEnv).toContain('export AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true');
		expect(oauthEnv).toContain('export AGY_CLI_DISABLE_AUTO_UPDATE=true');
		expect(oauthEnv).not.toContain('GEMINI_API_KEY');

		const apiEnv = antigravityEnvFileContent({
			kind: 'api-key',
			apiKey: "key'with'quote",
			baseUrl: 'https://example.com',
			source: 'test'
		});
		expect(apiEnv).toContain("export GEMINI_API_KEY='key'\\''with'\\''quote'");
		expect(apiEnv).toContain("export GOOGLE_GEMINI_BASE_URL='https://example.com'");
	});

	test('configured Gemini API key is redacted from boot logs', () => {
		setOption('antigravity_gemini_api_key', 'AIzaSySecretKey12345');
		invalidateSecretValues();
		expect(redactSecrets('using key AIzaSySecretKey12345 here')).toBe('using key •••• here');
	});

	test.skipIf(POSIX_SHELL_ONLY)(
		'LIVE_CREDENTIALS_CHECK detects both OAuth token and API key modes',
		() => {
			const home = mkdtempSync(join(tmpdir(), 'codebay-agy-check-'));
			const runCheck = () =>
				Bun.spawnSync(
					[
						'bash',
						'-c',
						LIVE_CREDENTIALS_CHECK.replace('h=$(eval echo ~$(id -un)); ', 'h="$HOME"; ')
					],
					{ env: { ...process.env, HOME: home } }
				)
					.stdout.toString()
					.trim();

			try {
				expect(runCheck()).toBe('0');

				// OAuth token present.
				mkdirSync(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
				writeFileSync(
					join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
					sampleToken
				);
				expect(runCheck()).toBe('1');

				// Blanked OAuth token fails.
				writeFileSync(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), '{}');
				expect(runCheck()).toBe('0');

				// Gemini API key env + modelProvider: "gemini" passes.
				writeFileSync(join(home, AGY_ENV_FILE), "export GEMINI_API_KEY='AIza-test'\n");
				writeFileSync(
					join(home, '.gemini', 'antigravity-cli', 'settings.json'),
					JSON.stringify({ modelProvider: 'gemini' })
				);
				expect(runCheck()).toBe('1');
			} finally {
				rmSync(home, { recursive: true, force: true });
			}
		}
	);
});

describe('Antigravity config, guardrails, hooks, and install', () => {
	test('default mode disables guardrails and mirrors host model/effort without host permissions', () => {
		const host = hostAntigravityConfigFrom({
			model: 'Gemini 4 Neon (XHigh)',
			effortByBase: { 'Gemini 4 Neon': 'xhigh', bogus: 'turbo' },
			permissions: { deny: ['command(*)'], ask: ['write_file(*)'] },
			customModelsConfig: { customModels: { m1: { modelName: 'gemini-api://x/models/m1' } } }
		});
		expect(host.model).toBe('Gemini 4 Neon (XHigh)');
		expect(host.effortByBase).toEqual({ 'Gemini 4 Neon': 'xhigh' });

		const patch = antigravitySettingsPatch({ mode: 'default', modelOverride: null, host });
		expect(patch).toMatchObject({
			toolPermission: 'always-proceed',
			agentMode: 'accept-edits',
			artifactReviewPolicy: 'always-proceed',
			allowNonWorkspaceAccess: true,
			enableTerminalSandbox: false,
			showTips: false,
			showFeedbackSurvey: false,
			model: 'Gemini 4 Neon (XHigh)',
			effortByBase: { 'Gemini 4 Neon': 'xhigh' }
		});
		expect(patch).not.toHaveProperty('permissions');

		// Explicit Settings model override wins over host model.
		const overridden = antigravitySettingsPatch({
			mode: 'plan',
			modelOverride: 'gemini-3.8-flash-medium',
			host
		});
		expect(overridden.model).toBe('gemini-3.8-flash-medium');
		expect(overridden.toolPermission).toBe('request-review');
		expect(overridden.agentMode).toBe('plan');
		expect(antigravityPermissionSettings('manual')).toMatchObject({
			toolPermission: 'request-review',
			agentMode: ''
		});
	});

	test.skipIf(POSIX_SHELL_ONLY)('agy alias and launcher preserve spaces in model labels', () => {
		const script = [
			'shopt -s expand_aliases',
			antigravityConfigEnvContent('Gemini 4 Neon (XHigh)', 'xhigh'),
			antigravityAliasLine('default').replace("alias agy='agy ", 'alias agy=\'printf "<%s>" '),
			'agy'
		].join('\n');
		const out = Bun.spawnSync(['bash', '-c', script]).stdout.toString();
		expect(out).toBe(
			'<--dangerously-skip-permissions><--model><Gemini 4 Neon (XHigh)><--effort><xhigh>'
		);

		// When unset, neither --model nor --effort is passed.
		const unsetScript = [
			'shopt -s expand_aliases',
			antigravityConfigEnvContent(null, 'default'),
			antigravityAliasLine('default').replace("alias agy='agy ", 'alias agy=\'printf "<%s>" '),
			'agy'
		].join('\n');
		expect(Bun.spawnSync(['bash', '-c', unsetScript]).stdout.toString()).toBe(
			'<--dangerously-skip-permissions>'
		);
	});

	test('attention hooks use Antigravity flat Stop/PreInvocation and wrapped PreToolUse schemas', () => {
		const cfg = antigravityAttentionHooksConfig('inst-1');
		expect(hasAntigravityAttentionHook(cfg, 'inst-1')).toBe(true);
		expect(hasAntigravityAttentionHook(cfg, 'inst-10')).toBe(false);

		const entry = cfg['codebay-attention'] as {
			Stop: { type: string; command: string }[];
			PreInvocation: { type: string; command: string }[];
			PreToolUse: { matcher: string; hooks: { type: string; command: string }[] }[];
		};
		expect(entry.Stop[0]!.command).toContain('state=done');
		expect(entry.Stop[0]!.command).toContain("printf '%s\\n' '{}'");
		expect(entry.PreInvocation[0]!.command).toContain('state=busy');
		// PreInvocation fires per model call, so only its ping is detached from the agent loop.
		expect(entry.PreInvocation[0]!.command).toContain('>/dev/null 2>&1 & ');
		expect(entry.Stop[0]!.command).not.toContain(' & ');
		expect(entry.PreToolUse[0]!.matcher).toBe('ask_question|ask_permission');
		expect(entry.PreToolUse[0]!.hooks[0]!.command).toContain('state=waiting');
		expect(entry.PreToolUse[0]!.hooks[0]!.command).toContain('{"decision":"allow"}');
		expect(entry.Stop[0]!.command).toContain('.bridge-header');
	});

	test('INSTALL_SCRIPT short-circuits, installs as remote user, and symlinks /usr/local/bin/agy', () => {
		expect(
			AGY_INSTALL_SCRIPT.startsWith('if command -v agy >/dev/null 2>&1; then exit 0; fi')
		).toBe(true);
		expect(AGY_INSTALL_SCRIPT).toContain('https://antigravity.google/cli/install.sh');
		expect(AGY_INSTALL_SCRIPT).toContain('su -m "$u"');
		expect(AGY_INSTALL_SCRIPT).toContain('ln -sf "$h/.local/bin/agy" /usr/local/bin/agy');
	});
});

describe('writeOverrideConfig with Antigravity', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-agy-dc-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test('omits codebay-antigravity when disabled, stages it when enabled', async () => {
		await writeOverrideConfig(dir, 8001);
		const offCfg = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8')
		);
		expect(offCfg.features['./codebay-antigravity']).toBeUndefined();
		expect(existsSync(join(dir, '.devcontainer', 'codebay-antigravity'))).toBe(false);

		mkdirSync(join(dir, '.git'), { recursive: true });
		await writeOverrideConfig(dir, 8001, [], undefined, 'ide', 'default', [], null, {
			enabled: true,
			defaultAgent: 'antigravity',
			permissionMode: 'default'
		});
		const onCfg = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8')
		);
		expect(onCfg.features['./codebay-antigravity']).toEqual({});
		expect(existsSync(join(dir, '.devcontainer', 'codebay-antigravity', 'install.sh'))).toBe(true);
		expect(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain(
			'/.devcontainer/codebay-antigravity/'
		);

		// IDE task launches agy cleanly without single-quote / ${ / glob hazards or Claude's IDE lock wait.
		const taskCmd = JSON.parse(readFileSync(join(dir, '.vscode', 'tasks.json'), 'utf8')).tasks[0]
			.command as string;
		const payload = taskCmd.slice(
			taskCmd.indexOf("new-session -A -s codebay '") + "new-session -A -s codebay '".length,
			taskCmd.indexOf("'; fi; MARK=")
		);
		expect(payload).toContain('agy --dangerously-skip-permissions "$@"');
		expect(payload).not.toContain('.claude/ide/');
		expect(payload).not.toContain("'");
		expect(payload).not.toContain('${');
		expect(payload).not.toMatch(/[*?]/);
		expect(SOURCE_INJECTED_ENV).toContain(`"$HOME/${AGY_ENV_FILE}"`);
		expect(launchAntigravity('accept-edits')).toContain('agy --mode=accept-edits "$@"');
		expect(launchAntigravity('default')).toContain(`$${MODEL_ENV_VAR}`);
		expect(launchAntigravity('default')).toContain(`$${EFFORT_ENV_VAR}`);
	});

	test('terminal mode launches agy when defaultAgent is antigravity', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal', 'default', [], null, {
			enabled: true,
			defaultAgent: 'antigravity',
			permissionMode: 'plan'
		});
		const script = readFileSync(join(dir, '.devcontainer', 'codebay-terminal.sh'), 'utf8');
		expect(script).toContain('agy --mode=plan "$@"');
		expect(script).not.toContain('claude --');
	});
});

describe('Settings actions for Antigravity', () => {
	type SettingsPage = {
		actions: Record<string, (arg: { formData: FormData }) => unknown>;
	};
	const actions = (routes['/settings'] as unknown as SettingsPage).actions;

	const post = (action: string, fields: Record<string, string>) => {
		const formData = new FormData();
		for (const [k, v] of Object.entries(fields)) formData.set(k, v);
		return actions[action]!({ formData });
	};

	test('round-trips Antigravity toggle, launcher, permissions, effort, model, API key, and dir', () => {
		post('antigravityToggle', { enabled: 'on' });
		expect(getOption('antigravity_enabled')).toBe('1');

		post('defaultAgent', { agent: 'antigravity' });
		expect(getOption('default_agent')).toBe('antigravity');

		post('antigravityPermissionMode', { mode: 'accept-edits' });
		expect(getOption('antigravity_permission_mode')).toBe('accept-edits');

		post('antigravityEffortLevel', { level: 'xhigh' });
		expect(getOption('antigravity_effort_level')).toBe('xhigh');

		post('antigravityModel', { model: 'gemini-4-neon-xhigh' });
		expect(getOption('antigravity_model')).toBe('gemini-4-neon-xhigh');

		post('antigravityGeminiApiKey', { apiKey: 'AIza-secret-test-key' });
		expect(getOption('antigravity_gemini_api_key')).toBe('AIza-secret-test-key');
		expect(redactSecrets('token AIza-secret-test-key ok')).toBe('token •••• ok');

		post('antigravityGeminiBaseUrl', { baseUrl: 'https://gemini.internal' });
		expect(getOption('antigravity_gemini_base_url')).toBe('https://gemini.internal');

		post('antigravityConfigDir', { dir: '~/custom-agy' });
		expect(getOption('antigravity_config_dir')).toBe('~/custom-agy');

		post('antigravityToggle', {});
		expect(getOption('antigravity_enabled')).toBe('0');
	});

	test('Settings sees the stored default agent even while Antigravity is disabled', () => {
		post('defaultAgent', { agent: 'antigravity' });
		post('antigravityToggle', {});
		// Re-enabling in place must not show Claude while the saved default is already Antigravity.
		expect(storedDefaultAgent()).toBe('antigravity');
		expect(getDefaultAgent()).toBe('claude');
	});
});
