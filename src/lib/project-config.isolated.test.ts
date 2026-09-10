import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setOption } from './db.server.ts';
import {
	parseProjectConfig,
	projectOverride,
	readProjectConfig,
	resolveHostVar
} from './project-config.server.ts';

function workspaceWith(contents: string | null): string {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-project-'));
	if (contents !== null) writeFileSync(join(dir, 'codebay.json'), contents, 'utf8');
	return dir;
}

describe('parseProjectConfig — overrides', () => {
	test('keeps every known key and reports nothing', () => {
		const config = parseProjectConfig(`{
      "overrides": {
        "claudeCodeToken": "MOCHI_CLAUDE_TOKEN",
        "githubToken": "MOCHI_GITHUB_AUTH",
        "gitUserName": "MOCHI_GIT_NAME",
        "gitUserEmail": "MOCHI_GIT_EMAIL"
      }
    }`);
		expect(config.overrides).toEqual({
			claudeCodeToken: 'MOCHI_CLAUDE_TOKEN',
			githubToken: 'MOCHI_GITHUB_AUTH',
			gitUserName: 'MOCHI_GIT_NAME',
			gitUserEmail: 'MOCHI_GIT_EMAIL'
		});
		expect(config.warnings).toEqual([]);
	});

	test('tolerates JSONC comments and trailing commas', () => {
		const config = parseProjectConfig(`{
      // the robot account
      "overrides": { "githubToken": "BOT", },
    }`);
		expect(config.overrides.githubToken).toBe('BOT');
		expect(config.warnings).toEqual([]);
	});

	test('drops an unknown key with a warning', () => {
		const config = parseProjectConfig('{ "overrides": { "gitHubAuth": "X" } }');
		expect(config.overrides).toEqual({});
		expect(config.warnings[0]).toContain('gitHubAuth');
	});

	test('rejects a value that is not an environment variable name', () => {
		const config = parseProjectConfig(
			'{ "overrides": { "githubToken": "ghp_literal-token", "gitUserName": 3 } }'
		);
		expect(config.overrides).toEqual({});
		expect(config.warnings).toHaveLength(2);
	});
});

describe('parseProjectConfig — ports', () => {
	test('reads a bare container port and a pinned host:container pair', () => {
		const config = parseProjectConfig('{ "ports": { "6969": "web", "8123:5173": "vite" } }');
		expect(config.ports).toEqual([
			{ containerPort: 5173, hostPort: 8123, name: 'vite' },
			{ containerPort: 6969, hostPort: null, name: 'web' }
		]);
		expect(config.warnings).toEqual([]);
	});

	test('rejects the reserved code-server and ttyd ports', () => {
		const config = parseProjectConfig('{ "ports": { "8080": "editor", "7681": "term" } }');
		expect(config.ports).toEqual([]);
		expect(config.warnings).toHaveLength(2);
	});

	test('rejects malformed keys and empty names', () => {
		const config = parseProjectConfig(
			'{ "ports": { "70000": "a", "x": "b", "1:2:3": "c", "3000": "  " } }'
		);
		expect(config.ports).toEqual([]);
		expect(config.warnings).toHaveLength(4);
	});

	test('collapses a noisy name and caps its length', () => {
		const config = parseProjectConfig(
			`{ "ports": { "3000": "  web\\n\\tserver ${'x'.repeat(40)}" } }`
		);
		expect(config.ports[0]!.name).toBe(`web server ${'x'.repeat(21)}`);
	});

	test('last duplicate container port wins, with a warning', () => {
		const config = parseProjectConfig('{ "ports": { "3000": "first", "8123:3000": "second" } }');
		expect(config.ports).toEqual([{ containerPort: 3000, hostPort: 8123, name: 'second' }]);
		expect(config.warnings[0]).toContain('more than once');
	});
});

describe('parseProjectConfig — malformed input', () => {
	test('unparseable JSON warns rather than throwing', () => {
		const config = parseProjectConfig('{ nope');
		expect(config.overrides).toEqual({});
		expect(config.warnings[0]).toContain('could not be parsed');
	});

	test('a non-object root warns', () => {
		expect(parseProjectConfig('[]').warnings[0]).toContain('JSON object');
	});

	test('wrong-shaped sections warn but leave the other one intact', () => {
		const config = parseProjectConfig('{ "overrides": [], "ports": { "3000": "web" } }');
		expect(config.warnings).toHaveLength(1);
		expect(config.ports).toHaveLength(1);
	});
});

describe('readProjectConfig', () => {
	test('a workspace with no codebay.json is empty and silent', async () => {
		const config = await readProjectConfig(workspaceWith(null));
		expect(config).toEqual({ overrides: {}, ports: [], warnings: [] });
	});

	test('reads the file at the workspace root', async () => {
		const dir = workspaceWith('{ "overrides": { "githubToken": "BOT_TOKEN" } }');
		expect((await readProjectConfig(dir)).overrides.githubToken).toBe('BOT_TOKEN');
	});
});

describe('resolveHostVar / projectOverride', () => {
	afterEach(() => {
		setOption('custom_env_vars_enabled', '0');
		setOption('custom_env_vars', '[]');
		delete Bun.env.CODEBAY_TEST_VAR;
	});

	test('a custom env var wins over the process environment', () => {
		setOption('custom_env_vars_enabled', '1');
		setOption('custom_env_vars', JSON.stringify([{ name: 'CODEBAY_TEST_VAR', value: 'from-ui' }]));
		Bun.env.CODEBAY_TEST_VAR = 'from-env';
		expect(resolveHostVar('CODEBAY_TEST_VAR')).toBe('from-ui');
	});

	test('a disabled custom-env-vars setting falls through to the process environment', () => {
		setOption('custom_env_vars_enabled', '0');
		setOption('custom_env_vars', JSON.stringify([{ name: 'CODEBAY_TEST_VAR', value: 'from-ui' }]));
		Bun.env.CODEBAY_TEST_VAR = 'from-env';
		expect(resolveHostVar('CODEBAY_TEST_VAR')).toBe('from-env');
	});

	test('an unset name resolves to null', () => {
		expect(resolveHostVar('CODEBAY_TEST_VAR')).toBeNull();
	});

	test('projectOverride resolves a declared key', async () => {
		Bun.env.CODEBAY_TEST_VAR = 'secret-value';
		const dir = workspaceWith('{ "overrides": { "githubToken": "CODEBAY_TEST_VAR" } }');
		expect(await projectOverride(dir, 'githubToken')).toEqual({
			value: 'secret-value',
			varName: 'CODEBAY_TEST_VAR'
		});
	});

	test('an undeclared key, an unset variable, and no workspace all fall through', async () => {
		const dir = workspaceWith('{ "overrides": { "githubToken": "CODEBAY_TEST_VAR" } }');
		expect(await projectOverride(dir, 'claudeCodeToken')).toBeNull();
		expect(await projectOverride(dir, 'githubToken')).toBeNull();
		expect(await projectOverride(null, 'githubToken')).toBeNull();
	});
});
