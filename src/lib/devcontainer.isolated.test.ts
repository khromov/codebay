import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLISH_HOST } from './config.server.ts';
import { setOption } from './db.server.ts';
import {
	devcontainerUpArgs,
	devcontainerUpEnv,
	launchCommandFor,
	overrideConfigPath,
	readDeclaredContainerPorts,
	restoreCanonicalConfig,
	TERMINAL_LAUNCHED_MARKER,
	writeOverrideConfig
} from './devcontainer.server.ts';

/** The `-ge <n>` bound the launcher gives the injections-done sentinel. */
function sentinelWaitSeconds(script: string): number {
	return Number(/\.codebay-injections-done" \] \|\| \[ "\$i" -ge (\d+) \]/.exec(script)?.[1]);
}

/**
 * Every `claude <flags>` launch must sit behind a presence check. Without one, a `claude` the
 * update injection has momentarily unlinked — or a project image that ships none — reaches the
 * user as a bare `command not found` right under "Waiting for codebay setup to finish".
 */
function expectGuardedClaude(script: string): void {
	const segments = script.split('claude --');
	expect(segments.length).toBeGreaterThan(1);
	for (const before of segments.slice(0, -1)) {
		expect(before.endsWith('if command -v claude >/dev/null 2>&1; then ')).toBe(true);
	}
}

/**
 * `relaunchSurface` re-runs these after a plain `docker start`, which never re-runs
 * postStartCommand. If the two ever fork, a restarted instance boots a different surface than a
 * freshly provisioned one — so pin them to the same string.
 */
describe('launchCommandFor', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-launch-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const postStart = () =>
		JSON.parse(readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8'))
			.postStartCommand as string;

	test('terminal mode returns exactly what writeOverrideConfig writes', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		expect(postStart()).toContain(launchCommandFor('terminal'));
	});

	test('ide mode returns exactly what writeOverrideConfig writes', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'ide');
		expect(postStart()).toContain(launchCommandFor('ide'));
	});

	// relaunchSurface re-runs this launcher after the injections have corrected the theme id for
	// the installed build; an unconditional copy would put the stale staged id back.
	test('ide launcher seeds code-server settings only when the file is missing', () => {
		const launch = launchCommandFor('ide');
		expect(launch).toContain('[ -f ~/.local/share/code-server/User/settings.json ] ||');
		expect(launch).not.toMatch(/&&\s*cp -f/);
	});

	test('guards the code-server launch by port, not by a self-matching cmdline pattern', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'ide');
		// Any `pgrep -f` pattern matching a code-server daemon also matches this launcher's own
		// argv (it carries the nohup line), so a cmdline guard fires every time and the fallback
		// launch never runs — leaving no recovery if the feature's entrypoint ever fails.
		expect(postStart()).toContain('(exec 3<>/dev/tcp/127.0.0.1/8080)');
		expect(postStart()).not.toContain('pgrep -f');
	});

	test('the IDE run-once marker has a single definition', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'ide');
		const task = readFileSync(join(dir, '.vscode', 'tasks.json'), 'utf8');
		expect(task).toContain(TERMINAL_LAUNCHED_MARKER);
	});
});

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

	test('excludes both reserved internal ports (8080 code-server, 7681 ttyd)', async () => {
		writeConfig(JSON.stringify({ forwardPorts: [8080, 7681, 3000] }));
		expect(await readDeclaredContainerPorts(dir)).toEqual([3000]);
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
		// Bounded: a boot that never writes the sentinel must still yield a terminal, and say so.
		expect(terminal.command).toContain('setup did not finish in time');
	});

	test('waits out an injection phase far longer than a real one', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		// The bug this guards: a 60s bound against a phase measured at 106.5s released the launcher
		// mid-`npm install -g`, straight into a `claude` the update injection had just unlinked.
		expect(sentinelWaitSeconds(terminal.command)).toBeGreaterThanOrEqual(300);
	});

	test('never execs claude without proving it exists first', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		expectGuardedClaude(terminal.command);
		// And an absent binary drops to a shell with an explanation rather than a bare error.
		expect(terminal.command).toContain('else echo "codebay: claude is not installed');
	});

	test('retries a missing claude only while setup is unfinished', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		// Past the sentinel no injection can be mid-reinstall, so a missing binary is permanent and
		// retrying would just stall the shell on every open of a project image without Claude Code.
		expect(terminal.command).toContain(
			'if [ ! -e "$HOME/.codebay-injections-done" ]; then i=0; until command -v claude'
		);
	});

	test('keeps the tmux payload free of quoting and glob hazards', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		const payload = terminal.command.slice(
			terminal.command.indexOf("new-session -A -s codebay '") +
				"new-session -A -s codebay '".length,
			terminal.command.indexOf("'; fi; MARK=")
		);
		// A `'` would end the tmux command early, `${` would be eaten by VS Code's substitution, and
		// an unmatched glob makes zsh print "no matches found" on every loop iteration.
		expect(payload).not.toContain("'");
		expect(payload).not.toContain('${');
		expect(payload).not.toMatch(/[*?]/);
	});

	test('holds claude until the IDE bridge lockfile appears, in both launch paths', async () => {
		await writeOverrideConfig(dir, 8001);
		const terminal = readTasks().tasks.find((t: { label: string }) => t.label === 'Terminal');
		// claude scans ~/.claude/ide/*.lock once at startup, so it must not race the extension host.
		const tmuxPath = terminal.command.split('.codebay-terminal-launched')[0];
		const fallbackPath = terminal.command.split('.codebay-terminal-launched')[1];
		for (const path of [tmuxPath, fallbackPath]) {
			expect(path).toContain('.claude/ide/');
			// Ordered after the injections sentinel and before claude launches.
			expect(path.indexOf('.codebay-injections-done')).toBeLessThan(path.indexOf('.claude/ide/'));
			expect(path.indexOf('.claude/ide/')).toBeLessThan(path.indexOf('claude --'));
		}
		// Bounded: an offline/uninstalled instance (lock never written) must still yield a terminal.
		expect(terminal.command).toContain('-ge 30');
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

	// Detection must stay ON: with it off, VS Code Web's pre-extension paint skips the preferred
	// scheme entirely and falls back to a hardcoded light theme. Both preferred themes being dark
	// is what makes leaving it on safe.
	test('pins a dark theme on both preferred branches and leaves detection on', async () => {
		await writeOverrideConfig(dir, 8001);
		const settings = readSettings();
		expect(settings['window.autoDetectColorScheme']).toBe(true);
		expect(settings['window.autoDetectHighContrast']).toBe(false);
		expect(settings['workbench.colorTheme']).toBe('Default Dark Modern');
		expect(settings['workbench.preferredDarkColorTheme']).toBe('Default Dark Modern');
		expect(settings['workbench.preferredLightColorTheme']).toBe('Default Dark Modern');
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
			readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8')
		);
		// Nested config form → feature path is relative to .devcontainer/.
		expect(config.features['./codebay-tmux']).toEqual({});
	});

	test('references the tmux feature relative to a root .devcontainer.json', async () => {
		const original = JSON.stringify({ image: 'debian' });
		writeFileSync(join(dir, '.devcontainer.json'), original);
		await writeOverrideConfig(dir, 8001);
		// Flat canonical form → the merged config sits next to it at the workspace root.
		const config = JSON.parse(readFileSync(join(dir, '.codebay.devcontainer.json'), 'utf8'));
		expect(config.features['./.devcontainer/codebay-tmux']).toEqual({});
		expect(existsSync(join(dir, '.devcontainer', 'codebay-tmux', 'install.sh'))).toBe(true);
		expect(readFileSync(join(dir, '.devcontainer.json'), 'utf8')).toBe(original);
	});

	test('sources the injected env files before launching claude', async () => {
		await writeOverrideConfig(dir, 8001);
		const command = readTasks().tasks[0].command as string;
		// The injections deliver ANTHROPIC_* through the rc files, which a `bash -c` task never
		// reads — without this the auto-launched claude ignores the model/LiteLLM settings.
		for (const file of ['.codebay-claude-env', '.codebay-claude-models-env', '.codebay-host-env']) {
			expect(command).toContain(`"$HOME/${file}"`);
		}
		expect(command.indexOf('.codebay-host-env')).toBeLessThan(command.indexOf('claude --'));
		// A glob would make zsh print "no matches found" when a file is absent.
		expect(command).not.toContain('.codebay-*');
	});

	test('renders the permission mode into the terminal task', async () => {
		await writeOverrideConfig(dir, 8001);
		expect(readTasks().tasks[0].command as string).toContain(
			'claude --dangerously-skip-permissions'
		);

		await writeOverrideConfig(dir, 8001, [], undefined, 'ide', 'plan');
		const planned = readTasks().tasks[0].command as string;
		expect(planned).toContain('claude --permission-mode plan');
		// The skip flag silently overrides --permission-mode, so the two must never be combined.
		expect(planned).not.toContain('--dangerously-skip-permissions');
	});

	test('replaces a malformed tasks.json rather than throwing', async () => {
		mkdirSync(join(dir, '.vscode'), { recursive: true });
		writeFileSync(join(dir, '.vscode', 'tasks.json'), 'not json at all');
		await writeOverrideConfig(dir, 8001);
		const labels = readTasks().tasks.map((t: { label: string }) => t.label);
		expect(labels).toEqual(['Terminal']);
	});

	const readDevcontainer = () =>
		JSON.parse(readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8'));

	test('launches code-server before the backgrounded extension install', async () => {
		await writeOverrideConfig(dir, 8001);
		const cmd = readDevcontainer().postStartCommand as string;
		expect(cmd).toContain('--install-extension anthropic.claude-code');
		// The download must trail the launch so it never sits on the boot critical path.
		expect(cmd.indexOf('nohup code-server')).toBeLessThan(cmd.indexOf('--install-extension'));
		// Fully detached (redirects + </dev/null + &) or `devcontainer up` waits on its open pipes.
		expect(cmd).toContain('>/tmp/code-server-ext.log 2>&1 </dev/null &');
		// Still ls-guarded so a container restart with the extension present skips the download.
		expect(
			cmd.indexOf('ls -d ~/.local/share/code-server/extensions/anthropic.claude-code-')
		).toBeLessThan(cmd.indexOf('--install-extension'));
	});

	test('the blocking-install escape hatch restores the install-before-launch order', async () => {
		setOption('advanced_blocking_ext_install', '1');
		try {
			await writeOverrideConfig(dir, 8001);
			const cmd = readDevcontainer().postStartCommand as string;
			expect(cmd.indexOf('--install-extension')).toBeLessThan(cmd.indexOf('nohup code-server'));
			// Foreground on purpose — no detach, so `up` waits and the first window has the extension.
			expect(cmd).not.toContain('</dev/null &');
			// The ls-guard still skips the download when the extension survived a rebuild.
			expect(
				cmd.indexOf('ls -d ~/.local/share/code-server/extensions/anthropic.claude-code-')
			).toBeLessThan(cmd.indexOf('--install-extension'));
		} finally {
			setOption('advanced_blocking_ext_install', '0');
		}
	});

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
		expect(text).toContain('/.devcontainer/codebay.devcontainer.json');
		expect(text).toContain('/.codebay.devcontainer.json');
		expect(text).toContain('/.devcontainer/code-server-settings.json');
		expect(text).toContain('/.devcontainer/devcontainer-lock.json');
		expect(text).toContain('/.devcontainer-lock.json');
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

describe('writeOverrideConfig separate config file', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-sep-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test('never touches the project devcontainer.json and reports where it wrote', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		const original = '{\n  // project-owned\n  "image": "ships/own:1",\n}\n';
		writeFileSync(join(dir, '.devcontainer', 'devcontainer.json'), original);
		const { configPath, overrideConfigPath } = await writeOverrideConfig(dir, 8001);
		expect(readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8')).toBe(original);
		expect(overrideConfigPath).toBe(join(dir, '.devcontainer', 'codebay.devcontainer.json'));
		// Only the project's own config may reach --config; the CLI rejects any other basename.
		expect(configPath).toBe(join(dir, '.devcontainer', 'devcontainer.json'));
		const merged = JSON.parse(readFileSync(overrideConfigPath, 'utf8'));
		expect(merged.image).toBe('ships/own:1');
		expect(merged.appPort).toEqual(['127.0.0.1:8001:8080']);
	});

	test('a config-less project gets only the codebay config, never a canonical one', async () => {
		const { imageSource, configPath, overrideConfigPath } = await writeOverrideConfig(
			dir,
			8001,
			[],
			'my/custom:42'
		);
		expect(imageSource).toBe('my/custom:42');
		expect(overrideConfigPath).toBe(join(dir, '.devcontainer', 'codebay.devcontainer.json'));
		// Nothing for --config to point at; the CLI then bases resolution on `.devcontainer/` anyway.
		expect(configPath).toBeNull();
		expect(existsSync(join(dir, '.devcontainer', 'devcontainer.json'))).toBe(false);
		expect(existsSync(join(dir, '.devcontainer.json'))).toBe(false);
	});

	test('rebuilds do not chain the launch command onto itself', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1', postStartCommand: 'echo hi' })
		);
		await writeOverrideConfig(dir, 8001);
		await writeOverrideConfig(dir, 8001);
		const merged = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8')
		);
		const launch = launchCommandFor('ide');
		// The legacy in-place scheme re-read its own output, appending the launch on every rebuild.
		expect((merged.postStartCommand as string).split(launch)).toHaveLength(2);
		expect(merged.postStartCommand).toStartWith('echo hi && ');
	});

	test('overrideConfigPath tracks the canonical form', () => {
		expect(overrideConfigPath(dir)).toBe(join(dir, '.devcontainer', 'codebay.devcontainer.json'));
		writeFileSync(join(dir, '.devcontainer.json'), '{}');
		expect(overrideConfigPath(dir)).toBe(join(dir, '.codebay.devcontainer.json'));
		// A nested config wins over the flat one, mirroring the CLI's lookup order.
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(join(dir, '.devcontainer', 'devcontainer.json'), '{}');
		expect(overrideConfigPath(dir)).toBe(join(dir, '.devcontainer', 'codebay.devcontainer.json'));
	});

	test('what goes to --config always has a filename the CLI accepts', async () => {
		// The CLI tests --config against this exact regex and refuses to boot otherwise — which is
		// why the Codebay-owned file rides --override-config instead of --config.
		const accepted = /\/\.?devcontainer\.json$/;
		const forms = [
			['.devcontainer', 'devcontainer.json'],
			['.devcontainer.json'],
			['.devcontainer', 'app', 'devcontainer.json']
		];
		for (const form of forms) {
			rmSync(dir, { recursive: true, force: true });
			mkdirSync(join(dir, ...form.slice(0, -1)), { recursive: true });
			writeFileSync(join(dir, ...form), '{}');
			const { configPath, overrideConfigPath } = await writeOverrideConfig(dir, 8001);
			expect(configPath).toMatch(accepted);
			expect(overrideConfigPath).not.toMatch(accepted);
		}
	});

	test('the flat form keeps both configs at the workspace root', async () => {
		writeFileSync(join(dir, '.devcontainer.json'), JSON.stringify({ image: 'ships/own:1' }));
		const { configPath, overrideConfigPath } = await writeOverrideConfig(dir, 8001);
		expect(overrideConfigPath).toBe(join(dir, '.codebay.devcontainer.json'));
		expect(configPath).toBe(join(dir, '.devcontainer.json'));
	});

	test('discovers the spec subfolder form and merges beside it', async () => {
		mkdirSync(join(dir, '.devcontainer', 'app'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'app', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1' })
		);
		const { imageSource, configPath, overrideConfigPath } = await writeOverrideConfig(dir, 8001);
		// Booting the default image here would silently override the project's declared one.
		expect(imageSource).toBe('local');
		expect(overrideConfigPath).toBe(join(dir, '.devcontainer', 'app', 'codebay.devcontainer.json'));
		// The CLI's own lookup skips the subfolder form, so --config must name it explicitly or the
		// `./codebay-tmux` paths below would resolve against `.devcontainer/` instead.
		expect(configPath).toBe(join(dir, '.devcontainer', 'app', 'devcontainer.json'));
		const merged = JSON.parse(readFileSync(overrideConfigPath, 'utf8'));
		expect(merged.image).toBe('ships/own:1');
		// Features stage beside the subfolder config — the CLI only promises `./`-descendant paths.
		expect(merged.features['./codebay-tmux']).toEqual({});
		expect(existsSync(join(dir, '.devcontainer', 'app', 'codebay-tmux', 'install.sh'))).toBe(true);
	});

	// What legacy versions appended to the canonical file's postStartCommand.
	const legacyLaunch =
		'bash -c "mkdir -p ~/.local/share/code-server/User; nohup code-server --bind-addr 0.0.0.0:8080 --auth none \\"$PWD\\" >/tmp/code-server.log 2>&1 &"';

	test('strips legacy in-place injections from an un-restorable canonical before merging', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({
				image: 'ships/own:1',
				features: {
					'ghcr.io/coder/devcontainer-features/code-server:1': { host: '0.0.0.0', auth: 'none' },
					'./codebay-tmux': {},
					'ghcr.io/devcontainers/features/go:1': {}
				},
				postStartCommand: `npm run prep && ${legacyLaunch}`
			})
		);
		await writeOverrideConfig(dir, 8001);
		const merged = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8')
		);
		// Exactly the user's own command plus the current launcher — no double-chained launch.
		expect(merged.postStartCommand).toBe(`npm run prep && ${launchCommandFor('ide')}`);
		// The project's own feature survives the strip.
		expect(merged.features['ghcr.io/devcontainers/features/go:1']).toEqual({});
	});

	test('a legacy canonical whose postStartCommand is only the launcher loses it entirely', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({
				image: 'ships/own:1',
				features: { './codebay-tmux': {} },
				postStartCommand: legacyLaunch
			})
		);
		await writeOverrideConfig(dir, 8001);
		const merged = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8')
		);
		expect(merged.postStartCommand).toBe(launchCommandFor('ide'));
	});
});

describe('restoreCanonicalConfig', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-restore-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const git = (...args: string[]) => {
		const proc = Bun.spawnSync(
			[
				'git',
				'-C',
				dir,
				'-c',
				'user.email=t@t',
				'-c',
				'user.name=t',
				'-c',
				'commit.gpgsign=false',
				...args
			],
			{ stdout: 'ignore', stderr: 'ignore' }
		);
		expect(proc.exitCode).toBe(0);
	};

	const configFile = () => join(dir, '.devcontainer', 'devcontainer.json');
	const pristine = JSON.stringify({ image: 'ships/own:1' });
	// What the legacy scheme left behind: the project's config with the injections baked in.
	const overwritten = JSON.stringify({
		image: 'ships/own:1',
		features: { './codebay-tmux': {} }
	});

	test('restores a tracked config the legacy scheme overwrote, stashing a backup', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(configFile(), pristine);
		git('init');
		git('add', '.');
		git('commit', '-m', 'init');
		writeFileSync(configFile(), overwritten);
		expect(await restoreCanonicalConfig(dir)).toBe('restored');
		expect(readFileSync(configFile(), 'utf8')).toBe(pristine);
		// The discarded file may have held user edits on top of the injection — it must survive.
		expect(readFileSync(configFile() + '.codebay-backup', 'utf8')).toBe(overwritten);
	});

	test('deletes an untracked fingerprinted config (created for a config-less project)', async () => {
		git('init');
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(configFile(), overwritten);
		expect(await restoreCanonicalConfig(dir)).toBe('deleted');
		expect(existsSync(configFile())).toBe(false);
		expect(readFileSync(configFile() + '.codebay-backup', 'utf8')).toBe(overwritten);
	});

	test('reports none (not restored) when the injection itself was committed', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(configFile(), overwritten);
		git('init');
		git('add', '.');
		git('commit', '-m', 'committed with injection baked in');
		// git checkout is a no-op here — pretending it restored anything would mislead the boot log.
		expect(await restoreCanonicalConfig(dir)).toBe('none');
		expect(readFileSync(configFile(), 'utf8')).toBe(overwritten);
		expect(existsSync(configFile() + '.codebay-backup')).toBe(false);
	});

	test('never touches a config without the injection fingerprint', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(configFile(), pristine);
		git('init');
		expect(await restoreCanonicalConfig(dir)).toBe('none');
		expect(readFileSync(configFile(), 'utf8')).toBe(pristine);
	});

	test('leaves a fingerprinted config alone outside a git repo', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(configFile(), overwritten);
		expect(await restoreCanonicalConfig(dir)).toBe('none');
		expect(readFileSync(configFile(), 'utf8')).toBe(overwritten);
	});

	test('returns none when there is no config at all', async () => {
		expect(await restoreCanonicalConfig(dir)).toBe('none');
	});
});

describe('writeOverrideConfig terminal mode', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-term-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const readDevcontainer = () =>
		JSON.parse(readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8'));
	const readLaunch = () => readFileSync(join(dir, '.devcontainer', 'codebay-terminal.sh'), 'utf8');

	test('swaps code-server for the ttyd feature, keeping tmux', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const features = readDevcontainer().features;
		expect(features['ghcr.io/coder/devcontainer-features/code-server:1']).toBeUndefined();
		expect(features['./codebay-ttyd']).toEqual({});
		expect(features['./codebay-tmux']).toEqual({});
	});

	test('maps the host port to ttyd (7681), not code-server (8080)', async () => {
		await writeOverrideConfig(
			dir,
			8001,
			[{ host_port: 8002, container_port: 3000 }],
			undefined,
			'terminal'
		);
		expect(readDevcontainer().appPort).toEqual([
			'127.0.0.1:8001:7681',
			`${PUBLISH_HOST}:8002:3000`
		]);
	});

	test('launches ttyd (writable, process-guarded) from the staged launcher script', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const cmd = readDevcontainer().postStartCommand as string;
		expect(cmd).toContain('ttyd --port 7681');
		expect(cmd).toContain('--writable');
		expect(cmd).toContain('.devcontainer/codebay-terminal.sh');
		// No code-server anywhere in a terminal-mode boot.
		expect(cmd).not.toContain('code-server');
	});

	test('the launcher bails when ttyd is missing, so a late install needs its own relaunch', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const cmd = readDevcontainer().postStartCommand as string;
		// postStartCommand runs before the injection that installs ttyd as a fallback, so a failed
		// build-time install leaves this a no-op — provision() relaunches afterwards to cover it.
		expect(cmd).toContain('command -v ttyd >/dev/null 2>&1 || exit 0');
	});

	test('guards the ttyd launch by process name, not by a self-matching cmdline pattern', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const cmd = readDevcontainer().postStartCommand as string;
		expect(cmd).toContain('pgrep -x ttyd');
		// `pgrep -f` matches the launch shell's own cmdline, so the guard would fire every time
		// and ttyd would never start (nothing ever listening on 7681).
		expect(cmd).not.toContain('pgrep -f');
	});

	test('the launcher runs claude under tmux and waits on the injections sentinel', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const script = readLaunch();
		expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
		expect(script).toContain('tmux new-session -A -s codebay');
		expect(script).toContain('claude --dangerously-skip-permissions');
		// Holds claude until injections finish, same as the code-server terminal task.
		expect(script).toContain('.codebay-injections-done');
		expect(script.indexOf('.codebay-injections-done')).toBeLessThan(script.indexOf('claude'));
		// No code-server extension host to race, so no IDE-bridge wait.
		expect(script).not.toContain('.claude/ide/');
	});

	test('gives the sentinel the same generous bound and guards claude, in both branches', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const script = readLaunch();
		expect(sentinelWaitSeconds(script)).toBeGreaterThanOrEqual(300);
		expect(script).toContain('setup did not finish in time');
		// Both the tmux session command and the bare-shell fallback launch claude.
		expectGuardedClaude(script);
	});

	test('sources the injected env files before launching claude', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const script = readLaunch();
		for (const file of ['.codebay-claude-env', '.codebay-claude-models-env', '.codebay-host-env']) {
			expect(script).toContain(`"$HOME/${file}"`);
		}
		// ttyd runs `bash <script>` and tmux runs its command via `$SHELL -c`, so nothing here
		// reads the rc files the injections write to — the sourcing must be explicit.
		expect(script.indexOf('.codebay-host-env')).toBeLessThan(script.indexOf('claude --'));
		expect(script).not.toContain('.codebay-*');
	});

	test('renders the permission mode into the launcher', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal', 'plan');
		const script = readLaunch();
		expect(script).toContain('claude --permission-mode plan');
		// The skip flag silently overrides --permission-mode, so the two must never be combined.
		expect(script).not.toContain('--dangerously-skip-permissions');
	});

	test('serves the split view by letting the URL pick the session', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		// Without --url-arg ttyd drops the `?arg=` the shell pane sends, and both panes would
		// attach to the same claude session.
		expect(readDevcontainer().postStartCommand as string).toContain('--url-arg');

		const script = readLaunch();
		expect(script).toContain('tmux new-session -A -s codebay-shell');
		// The scratch shell must not sit behind claude's boot sentinel — it opens on demand.
		expect(script.indexOf('codebay-shell')).toBeLessThan(
			script.indexOf('.codebay-injections-done')
		);
		// `$1` is attacker-supplied via the URL, so it may only ever be compared, never run.
		expect(script).toContain('[ "$1" = "shell" ]');
		expect(script).not.toContain('eval');
	});

	test('stages the codebay-ttyd feature with a best-effort install script', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const meta = JSON.parse(
			readFileSync(join(dir, '.devcontainer', 'codebay-ttyd', 'devcontainer-feature.json'), 'utf8')
		);
		expect(meta.id).toBe('codebay-ttyd');
		const install = readFileSync(join(dir, '.devcontainer', 'codebay-ttyd', 'install.sh'), 'utf8');
		expect(install.startsWith('#!/bin/sh\n')).toBe(true);
		expect(install).toContain('command -v ttyd');
		expect(install.trimEnd().endsWith('exit 0')).toBe(true);
	});

	test('skips the code-server settings file and the VS Code Terminal task', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		expect(existsSync(join(dir, '.devcontainer', 'code-server-settings.json'))).toBe(false);
		expect(existsSync(join(dir, '.vscode', 'tasks.json'))).toBe(false);
	});

	test('excludes the terminal-mode artifacts from git', async () => {
		mkdirSync(join(dir, '.git'), { recursive: true });
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const text = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
		expect(text).toContain('/.devcontainer/codebay-ttyd/');
		expect(text).toContain('/.devcontainer/codebay-claude/');
		expect(text).toContain('/.devcontainer/codebay-terminal.sh');
	});

	test('installs Claude Code even when the source ships its own config', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1' })
		);
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const features = readDevcontainer().features;
		// The launcher *is* `claude`, so unlike IDE mode terminal mode can't defer tooling to the
		// project's config — a bare shell would defeat the whole "just Claude in a terminal" point.
		expect(features['./codebay-claude']).toBeDefined();
		// But not via the upstream features: their nvm-based Node install fails outright on any
		// project image that sets NPM_CONFIG_PREFIX. The local feature sniffs instead.
		expect(features['ghcr.io/devcontainers/features/node:1']).toBeUndefined();
		expect(features['ghcr.io/anthropics/devcontainer-features/claude-code:1.0']).toBeUndefined();
		// gh is a plain package install with no such hazard, so it stays.
		expect(features['ghcr.io/devcontainers/features/github-cli:1']).toBeDefined();
	});

	test('stages the codebay-claude feature with a best-effort, nvm-free install script', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1' })
		);
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const featureDir = join(dir, '.devcontainer', 'codebay-claude');
		const meta = JSON.parse(readFileSync(join(featureDir, 'devcontainer-feature.json'), 'utf8'));
		expect(meta.id).toBe('codebay-claude');
		const install = readFileSync(join(featureDir, 'install.sh'), 'utf8');
		expect(install.startsWith('#!/bin/sh\n')).toBe(true);
		expect(install).toContain('command -v claude');
		expect(install).not.toContain('nvm');
		// Wrapped so a failed install can never break the build; the injection retries at boot.
		expect(install.trimEnd().endsWith('exit 0')).toBe(true);
		expect(statSync(join(featureDir, 'install.sh')).mode & 0o111).toBeGreaterThan(0);
	});

	test('uses the upstream Claude features, not the local one, for the default image', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'terminal');
		const features = readDevcontainer().features;
		expect(features['ghcr.io/anthropics/devcontainer-features/claude-code:1.0']).toBeDefined();
		expect(features['./codebay-claude']).toBeUndefined();
		expect(existsSync(join(dir, '.devcontainer', 'codebay-claude'))).toBe(false);
	});

	test('never stages the codebay-claude feature in IDE mode', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1' })
		);
		await writeOverrideConfig(dir, 8001);
		expect(readDevcontainer().features['./codebay-claude']).toBeUndefined();
		expect(existsSync(join(dir, '.devcontainer', 'codebay-claude'))).toBe(false);
	});
});

describe('writeOverrideConfig containerEnv', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-env-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const readDevcontainer = () =>
		JSON.parse(readFileSync(join(dir, '.devcontainer', 'codebay.devcontainer.json'), 'utf8'));

	test('renders the provided env vars as containerEnv', async () => {
		await writeOverrideConfig(dir, 8001, [], undefined, 'ide', 'default', [
			{ name: 'FOO', value: 'bar' },
			{ name: 'TOKEN', value: 'sk-secret' }
		]);
		expect(readDevcontainer().containerEnv).toEqual({ FOO: 'bar', TOKEN: 'sk-secret' });
	});

	test('adds no containerEnv key when there are no env vars', async () => {
		await writeOverrideConfig(dir, 8001);
		expect(readDevcontainer().containerEnv).toBeUndefined();
	});

	test('merges over a project-declared containerEnv, letting configured names win', async () => {
		mkdirSync(join(dir, '.devcontainer'), { recursive: true });
		writeFileSync(
			join(dir, '.devcontainer', 'devcontainer.json'),
			JSON.stringify({ image: 'ships/own:1', containerEnv: { KEEP: 'me', FOO: 'old' } })
		);
		await writeOverrideConfig(dir, 8001, [], undefined, 'ide', 'default', [
			{ name: 'FOO', value: 'new' }
		]);
		expect(readDevcontainer().containerEnv).toEqual({ KEEP: 'me', FOO: 'new' });
	});
});

describe('devcontainerUp args and env', () => {
	test('builds the baseline up args without cache-busting by default', () => {
		const args = devcontainerUpArgs('/ws/dir');
		expect(args.slice(1)).toEqual([
			'up',
			'--workspace-folder',
			'/ws/dir',
			'--remove-existing-container'
		]);
	});

	test('appends --build-no-cache only when noCache is set', () => {
		expect(devcontainerUpArgs('/ws/dir', { noCache: true })).toContain('--build-no-cache');
		expect(devcontainerUpArgs('/ws/dir', {})).not.toContain('--build-no-cache');
	});

	test('passes each config path under its own flag, and only when given', () => {
		const configPath = '/ws/dir/.devcontainer/devcontainer.json';
		const overrideConfigPath = '/ws/dir/.devcontainer/codebay.devcontainer.json';
		const args = devcontainerUpArgs('/ws/dir', { configPath, overrideConfigPath });
		expect(args[args.indexOf('--config') + 1]).toBe(configPath);
		expect(args[args.indexOf('--override-config') + 1]).toBe(overrideConfigPath);
		expect(devcontainerUpArgs('/ws/dir', { overrideConfigPath })).not.toContain('--config');
		expect(devcontainerUpArgs('/ws/dir', {})).not.toContain('--override-config');
	});

	test('enables BuildKit as a default the caller environment can override', () => {
		const prev = process.env.DOCKER_BUILDKIT;
		try {
			delete process.env.DOCKER_BUILDKIT;
			expect(devcontainerUpEnv().DOCKER_BUILDKIT).toBe('1');
			expect(devcontainerUpEnv().COMPOSE_DOCKER_CLI_BUILD).toBe('1');
			// An explicit user opt-out must win over our default.
			process.env.DOCKER_BUILDKIT = '0';
			expect(devcontainerUpEnv().DOCKER_BUILDKIT).toBe('0');
		} finally {
			if (prev === undefined) delete process.env.DOCKER_BUILDKIT;
			else process.env.DOCKER_BUILDKIT = prev;
		}
	});

	test('the no-buildkit escape hatch drops both forced env defaults', () => {
		const prev = process.env.DOCKER_BUILDKIT;
		setOption('advanced_no_buildkit', '1');
		try {
			delete process.env.DOCKER_BUILDKIT;
			expect(devcontainerUpEnv().DOCKER_BUILDKIT).toBeUndefined();
			expect(devcontainerUpEnv().COMPOSE_DOCKER_CLI_BUILD).toBeUndefined();
		} finally {
			setOption('advanced_no_buildkit', '0');
			if (prev === undefined) delete process.env.DOCKER_BUILDKIT;
			else process.env.DOCKER_BUILDKIT = prev;
		}
	});
});
