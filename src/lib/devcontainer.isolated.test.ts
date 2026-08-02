import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLISH_HOST } from './config.server.ts';
import { readDeclaredContainerPorts, writeOverrideConfig } from './devcontainer.server.ts';

describe('readDeclaredContainerPorts', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-decl-'));
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
		dir = mkdtempSync(join(tmpdir(), 'codebay-task-'));
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

	test('runs the terminal inside a persistent tmux session when available', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		// Create-or-attach: -A doubles as the run-once gate and reattaches the live
		// session (Claude + scrollback) after the browser reaped the previous PTY.
		expect(terminal.command).toContain("exec tmux new-session -A -s codebay '");
		// Guarded on tmux actually being installed, and ordered before the fallback.
		expect(terminal.command).toContain('command -v tmux');
		expect(terminal.command.indexOf('tmux')).toBeLessThan(
			terminal.command.indexOf('.codebay-terminal-launched')
		);
		// $SHELL must be left for tmux's sh -c, not VS Code's ${...} resolver.
		expect(terminal.command).toContain('exec "$SHELL" -l');
	});

	test('holds claude until the injections-done sentinel appears, in both launch paths', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		// A claude that starts mid-injection clobbers the trust keys on its next config rewrite.
		const tmuxPath = terminal.command.split('.codebay-terminal-launched')[0];
		const fallbackPath = terminal.command.split('.codebay-terminal-launched')[1];
		for (const path of [tmuxPath, fallbackPath]) {
			expect(path).toContain('.codebay-injections-done');
			expect(path.indexOf('.codebay-injections-done')).toBeLessThan(path.indexOf('claude'));
		}
		// Bounded: a boot that never writes the sentinel must still yield a terminal.
		expect(terminal.command).toContain('-ge 60');
	});

	test('falls back to the first-open marker gate when tmux is missing', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		// folderOpen re-fires on every load; the command no-ops after the first open.
		expect(terminal.command).toContain('.codebay-terminal-launched');
		expect(terminal.command).toContain('exit 0');
		expect(terminal.command).toContain('exec ${env:SHELL} -l');
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

	test('replaces a stale Terminal task on rerun instead of keeping it', async () => {
		mkdirSync(join(dir, '.vscode'), { recursive: true });
		writeFileSync(
			join(dir, '.vscode', 'tasks.json'),
			JSON.stringify({
				version: '2.0.0',
				tasks: [
					{ label: 'Build', type: 'shell', command: 'make' },
					{
						label: 'Terminal',
						type: 'shell',
						command: 'old-command-from-previous-version',
						runOptions: { runOn: 'folderOpen' }
					}
				]
			})
		);
		await writeOverrideConfig(dir, 8001);
		const tasks = readTasks().tasks;
		const terminals = tasks.filter((t: { label: string }) => t.label === 'Terminal');
		expect(terminals).toHaveLength(1);
		// A rebuild must pick up the current command, not keep the stale one forever.
		expect(terminals[0].command).toContain('tmux new-session');
		expect(terminals[0].command).not.toContain('old-command-from-previous-version');
		expect(tasks.map((t: { label: string }) => t.label)).toContain('Build');
	});

	test('stages the local codebay-tmux feature and registers it in features', async () => {
		await writeOverrideConfig(dir, 8001);
		const meta = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay-tmux', 'devcontainer-feature.json'), 'utf8')
		);
		expect(meta.id).toBe('codebay-tmux');
		const install = readFileSync(join(dir, '.devcontainer', 'codebay-tmux', 'install.sh'), 'utf8');
		// Best-effort: the actual install runs in a subshell and the script always exits 0,
		// so a failed install (offline build, unsupported distro) can never break the build.
		expect(install.startsWith('#!/bin/sh\n')).toBe(true);
		expect(install).toContain('command -v tmux');
		expect(install.trimEnd().endsWith('exit 0')).toBe(true);
		const config = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8')
		);
		// Nested config form → feature path is relative to .devcontainer/.
		expect(config.features['./codebay-tmux']).toEqual({});
	});

	test('references the tmux feature relative to a root .devcontainer.json', async () => {
		writeFileSync(join(dir, '.devcontainer.json'), JSON.stringify({ image: 'debian' }));
		await writeOverrideConfig(dir, 8001);
		const config = JSON.parse(readFileSync(join(dir, '.devcontainer.json'), 'utf8'));
		// Flat config form → path from the workspace root into .devcontainer/.
		expect(config.features['./.devcontainer/codebay-tmux']).toEqual({});
		expect(existsSync(join(dir, '.devcontainer', 'codebay-tmux', 'install.sh'))).toBe(true);
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

	test('preserves string values containing ,} while still stripping real trailing commas', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			'{\n  "image": "ships/own:1",\n  "postCreateCommand": "echo {a,}",\n}'
		);
		await writeOverrideConfig(dir, 8001);
		expect(readDevcontainer().postCreateCommand).toBe('echo {a,}');
	});

	test('renders appPort with code-server pinned to loopback and forwards on PUBLISH_HOST', async () => {
		await writeOverrideConfig(dir, 8001, [{ host_port: 8002, container_port: 3000 }]);
		expect(readDevcontainer().appPort).toEqual([
			// code-server never leaves loopback — it runs with auth disabled.
			'127.0.0.1:8001:8080',
			`${PUBLISH_HOST}:8002:3000`
		]);
	});

	test('discards a user-authored appPort instead of merging it', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1', appPort: ['9999:9999'] })
		);
		await writeOverrideConfig(dir, 8001);
		expect(readDevcontainer().appPort).toEqual(['127.0.0.1:8001:8080']);
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

describe('writeOverrideConfig local git excludes', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-excl-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const excludePath = () => join(dir, '.git', 'info', 'exclude');
	const readExclude = () => readFileSync(excludePath(), 'utf8');

	test('seeds .git/info/exclude with the manager artifacts when the copy is a git repo', async () => {
		mkdirSync(join(dir, '.git'), { recursive: true });
		await writeOverrideConfig(dir, 8001);
		const text = readExclude();
		expect(text).toContain('# >>> codebay (auto-generated) >>>');
		expect(text).toContain('/.devcontainer/code-server-settings.json');
		expect(text).toContain('/.devcontainer/devcontainer-lock.json');
		expect(text).toContain('/.vscode/tasks.json');
	});

	test('is idempotent — the manager block appears once across reruns', async () => {
		mkdirSync(join(dir, '.git'), { recursive: true });
		await writeOverrideConfig(dir, 8001);
		await writeOverrideConfig(dir, 8001);
		const markers = readExclude().match(/codebay \(auto-generated\)/g) ?? [];
		expect(markers).toHaveLength(1);
	});

	test('preserves pre-existing exclude entries', async () => {
		mkdirSync(join(dir, '.git', 'info'), { recursive: true });
		writeFileSync(excludePath(), 'my-secret.txt\n');
		await writeOverrideConfig(dir, 8001);
		const text = readExclude();
		expect(text).toContain('my-secret.txt');
		expect(text).toContain('/.devcontainer/code-server-settings.json');
	});

	test('is a no-op when the copy is not a git repo', async () => {
		await writeOverrideConfig(dir, 8001);
		expect(existsSync(join(dir, '.git'))).toBe(false);
	});
});
