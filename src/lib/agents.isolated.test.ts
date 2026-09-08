import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'smol-toml';
import { db, setOption } from './db.server.ts';
import { getAgentSettings, getAgentSelection, manualCredentialEnabled } from './agents.server.ts';
import { locateCodexCredential, validCodexAuth, hostCodexDir } from './host-codex.server.ts';
import { resolveInjections, resolveInjectionStages } from './injections.server.ts';
import { codexConfigPatch } from '../container-injections/codex-config.ts';
import { managedCodexHooks } from '../container-injections/codex-attention-hooks.ts';
import { hostFileNameFor } from './log-capture.server.ts';
import { getAttention, setAttention, clearAttention } from './bridge.server.ts';
import { codexConfigFile } from './codex-settings.server.ts';
import { writeFileScript } from './container-files.server.ts';

const changed = new Set<string>();
const dirs: string[] = [];
test.skipIf(process.platform === 'win32')(
	'Codex skill filenames remain literal in the container shell',
	() => {
		const dir = mkdtempSync(join(tmpdir(), 'codebay-codex-filename-'));
		dirs.push(dir);
		const name = '$(touch injected)`touch other`".md';
		const script = writeFileScript({ ...codexConfigFile(name), dir });
		const result = Bun.spawnSync(['bash', '-c', script], {
			cwd: dir,
			env: { ...process.env, CODEBAY_STDIN: 'instructions' }
		});
		expect(result.exitCode).toBe(0);
		expect(Bun.file(join(dir, name)).size).toBe(12);
	}
);
test('one agent resuming cannot dismiss the other agent waiting for input', () => {
	const id = 'attention-two-agents';
	setAttention(id, 'waiting', 'claude');
	setAttention(id, 'done', 'codex');
	expect(getAttention(id)).toBe('waiting');
	clearAttention(id, 'codex');
	expect(getAttention(id)).toBe('waiting');
	setAttention(id, 'done', 'codex');
	clearAttention(id, 'claude');
	expect(getAttention(id)).toBe('done');
	clearAttention(id);
	expect(getAttention(id)).toBeNull();
});
function option(key: string, value: string) {
	changed.add(key);
	setOption(key, value);
}
afterEach(() => {
	for (const key of changed) db.query('DELETE FROM options WHERE key = ?').run(key);
	changed.clear();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('selection filters every provider side effect independently of the editor surface', () => {
	for (const mode of ['ide', 'terminal'] as const) {
		const claude = resolveInjections(mode, 'claude').map((injection) => injection.id);
		const codex = resolveInjections(mode, 'codex').map((injection) => injection.id);
		const both = resolveInjections(mode, 'both').map((injection) => injection.id);
		expect(claude.some((id) => id.startsWith('codex-'))).toBe(false);
		expect(codex.some((id) => id.startsWith('claude-') || id === 'attention-hooks')).toBe(false);
		expect(codex).toContain('github-credentials');
		expect(both).toContain('claude-code-install');
		expect(both).toContain('codex-install');
		expect(new Set(both).size).toBe(both.length);
		expect(both.includes('codex-ide-extension')).toBe(mode === 'ide');
	}
	option('agent_selection', 'codex');
	expect(getAgentSelection()).toBe('codex');
	expect(resolveInjections('terminal').map((i) => i.id)).toContain('codex-install');
});

test('Codex writes never race shell, package or extension changes in Claude stages', () => {
	const stages = resolveInjectionStages('ide', 'both');
	const stageOf = (id: string) => stages.findIndex((stage) => stage.some((i) => i.id === id));
	expect(stageOf('codex-config')).toBeGreaterThan(stageOf('claude-permission-mode'));
	expect(stageOf('codex-install')).toBeGreaterThan(stageOf('claude-code-update'));
	expect(stageOf('codex-ide-extension')).toBeGreaterThan(stageOf('code-server-dark'));
});

test('manual credential migration preserves existing choices and splits GitHub from Claude', () => {
	option('manual_tokens_enabled', '1');
	expect(manualCredentialEnabled('github')).toBe(true);
	expect(manualCredentialEnabled('claude')).toBe(true);
	option('manual_claude_enabled', '0');
	expect(manualCredentialEnabled('claude')).toBe(false);
	expect(manualCredentialEnabled('github')).toBe(true);
});

test('manual Codex key takes precedence without leaking its value in settings', async () => {
	option('codex_api_key', 'test-key');
	expect(await locateCodexCredential()).toMatchObject({
		value: JSON.stringify({ OPENAI_API_KEY: 'test-key' })
	});
	expect(getAgentSettings().codexKeySet).toBe(true);
	expect(JSON.stringify(getAgentSettings())).not.toContain('test-key');
});

test('Codex auth rejects blank or malformed credential records', () => {
	for (const raw of ['', '{}', 'null', 'oops', '{"tokens":{"access_token":""}}'])
		expect(validCodexAuth(raw)).toBe(false);
	expect(validCodexAuth('{"OPENAI_API_KEY":"test"}')).toBe(true);
	expect(validCodexAuth('{"tokens":{"access_token":"test","refresh_token":"refresh"}}')).toBe(true);
});

test('Codex settings round-trip TOML and do not import host-specific paths or trust', () => {
	const settings = {
		...getAgentSettings(),
		codexModel: 'model-test',
		codexEndpointEnabled: true,
		codexBaseUrl: 'https://example.test/v1'
	};
	const patch = codexConfigPatch(
		settings,
		{
			model: 'old',
			model_reasoning_effort: 'high',
			tui: { status_line: ['model-name'] },
			projects: { '/host/private': { trust_level: 'trusted' } },
			mcp_servers: { host: { command: '/host/bin' } }
		},
		'/workspace/project'
	);
	const parsed = parse(stringify(patch));
	expect(parsed.model).toBe('model-test');
	expect(parsed.model_reasoning_effort).toBe('high');
	expect(parsed.projects).toEqual({ '/workspace/project': { trust_level: 'trusted' } });
	expect(parsed.mcp_servers).toBeUndefined();
	expect(parsed.cli_auth_credentials_store).toBe('file');
	expect(parsed.model_providers).toMatchObject({
		codebay: { wire_api: 'responses', base_url: 'https://example.test/v1' }
	});
});

test('custom Codex host directory is used instead of the actual user profile', () => {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-codex-auth-'));
	dirs.push(dir);
	option('codex_config_dir', dir);
	mkdirSync(join(dir, 'skills'));
	writeFileSync(join(dir, 'config.toml'), 'model = "test"\n');
	expect(hostCodexDir()).toBe(dir);
});

test('managed hooks use native permission and turn events without embedding a token', () => {
	const hooks = managedCodexHooks();
	expect(Object.keys(hooks)).toEqual([
		'Stop',
		'PermissionRequest',
		'UserPromptSubmit',
		'PreToolUse',
		'PostToolUse'
	]);
	expect(JSON.stringify(hooks)).not.toContain('X-Bridge-Token');
	expect(parse(stringify({ hooks })).hooks).toEqual(hooks);
});

test('Codex log names cannot collide with Claude or nested Codex sessions', () => {
	expect(hostFileNameFor('instance', 'codex:/custom/history.jsonl')).toBe(
		'codex-history-instance.jsonl'
	);
	expect(hostFileNameFor('instance', '/home/node/.claude/history.jsonl')).toBe(
		'history-instance.jsonl'
	);
	expect(hostFileNameFor('instance', 'codex:/custom/sessions/a/same.jsonl')).not.toBe(
		hostFileNameFor('instance', 'codex:/custom/sessions/b/same.jsonl')
	);
});
