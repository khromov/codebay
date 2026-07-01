import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDeclaredContainerPorts, writeOverrideConfig } from './devcontainer.server.ts';

describe('readDeclaredContainerPorts', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dcm-decl-'));
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function writeConfig(json: string) {
		writeFileSync(join(dir, '.devcontainer', 'devcontainer.json'), json);
	}

	test('returns [] when no devcontainer.json exists', async () => {
		expect(await readDeclaredContainerPorts(dir)).toEqual([]);
	});

	test('collects forwardPorts and appPort container ports, excluding 8080', async () => {
		writeConfig(
			JSON.stringify({
				forwardPorts: [3000, '5173'],
				appPort: ['127.0.0.1:8001:8080', 9000, '4000']
			})
		);
		const ports = await readDeclaredContainerPorts(dir);
		// host:container forms contribute their container (last) segment; 8080 is dropped.
		expect([...ports].sort((a, b) => a - b)).toEqual([3000, 4000, 5173, 9000]);
	});

	test('parses the host:container appPort form and dedupes', async () => {
		writeConfig(JSON.stringify({ forwardPorts: [3333], appPort: '8002:3333' }));
		expect(await readDeclaredContainerPorts(dir)).toEqual([3333]);
	});

	test('tolerates JSONC comments and returns [] on unparseable input', async () => {
		writeConfig('{ // dev\n "forwardPorts": [3000,], }');
		expect(await readDeclaredContainerPorts(dir)).toEqual([3000]);
		writeConfig('not json at all');
		expect(await readDeclaredContainerPorts(dir)).toEqual([]);
	});
});

describe('writeOverrideConfig terminal task + settings', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dcm-task-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const readTasks = () => JSON.parse(readFileSync(join(dir, '.vscode', 'tasks.json'), 'utf8'));
	const readSettings = () =>
		JSON.parse(readFileSync(join(dir, '.devcontainer', 'code-server-settings.json'), 'utf8'));

	test('creates .vscode/tasks.json with the folderOpen Terminal task', async () => {
		await writeOverrideConfig(dir, 8001);
		const tasks = readTasks();
		expect(tasks.version).toBe('2.0.0');
		const terminal = tasks.tasks.find((t: { label: string }) => t.label === 'Terminal');
		expect(terminal).toBeDefined();
		expect(terminal.runOptions.runOn).toBe('folderOpen');
	});

	test('stages task.allowAutomaticTasks in code-server settings', async () => {
		await writeOverrideConfig(dir, 8001);
		expect(readSettings()['task.allowAutomaticTasks']).toBe('on');
	});

	test('disables workspace trust in code-server settings', async () => {
		await writeOverrideConfig(dir, 8001);
		expect(readSettings()['security.workspace.trust.enabled']).toBe(false);
	});

	test('preserves an existing unrelated task and appends Terminal', async () => {
		mkdirSync(join(dir, '.vscode'), { recursive: true });
		writeFileSync(
			join(dir, '.vscode', 'tasks.json'),
			JSON.stringify({
				version: '2.0.0',
				tasks: [{ label: 'Build', type: 'shell', command: 'make' }]
			})
		);
		await writeOverrideConfig(dir, 8001);
		const labels = readTasks().tasks.map((t: { label: string }) => t.label);
		expect(labels).toContain('Build');
		expect(labels).toContain('Terminal');
	});

	test('does not duplicate the Terminal task across reruns', async () => {
		await writeOverrideConfig(dir, 8001);
		await writeOverrideConfig(dir, 8001);
		const terminals = readTasks().tasks.filter((t: { label: string }) => t.label === 'Terminal');
		expect(terminals).toHaveLength(1);
	});

	test('replaces a malformed tasks.json rather than throwing', async () => {
		mkdirSync(join(dir, '.vscode'), { recursive: true });
		writeFileSync(join(dir, '.vscode', 'tasks.json'), 'not json at all');
		await writeOverrideConfig(dir, 8001);
		const labels = readTasks().tasks.map((t: { label: string }) => t.label);
		expect(labels).toEqual(['Terminal']);
	});

	const readDevcontainer = () =>
		JSON.parse(readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8'));

	test('injects the provided default image and reports it when the folder has no config', async () => {
		const { imageSource } = await writeOverrideConfig(dir, 8001, [], 'my/custom:42');
		expect(imageSource).toBe('my/custom:42');
		expect(readDevcontainer().image).toBe('my/custom:42');
	});

	test('reports "local" and keeps the existing image when the folder ships a config', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1' })
		);
		const { imageSource } = await writeOverrideConfig(dir, 8001, [], 'my/custom:42');
		expect(imageSource).toBe('local');
		expect(readDevcontainer().image).toBe('ships/own:1');
	});

	test('installs the Node + Claude Code features for the default config', async () => {
		await writeOverrideConfig(dir, 8001);
		const features = readDevcontainer().features;
		expect(features['ghcr.io/anthropics/devcontainer-features/claude-code:1.0']).toBeDefined();
		// Claude Code needs Node, which the bare base image doesn't ship.
		expect(features['ghcr.io/devcontainers/features/node:1']).toBeDefined();
	});

	test('does not add the Claude Code feature when the folder ships a config', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1' })
		);
		await writeOverrideConfig(dir, 8001);
		const features = readDevcontainer().features;
		expect(features['ghcr.io/anthropics/devcontainer-features/claude-code:1.0']).toBeUndefined();
		// Node rides the same default-only branch, so it isn't added either.
		expect(features['ghcr.io/devcontainers/features/node:1']).toBeUndefined();
		// code-server is still injected for project-supplied configs.
		expect(features['ghcr.io/coder/devcontainer-features/code-server:1']).toBeDefined();
	});
});
