import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { INSTALL_SCRIPT as TMUX_INSTALL_SCRIPT } from '../container-injections/tmux.ts';
import { INSTALL_SCRIPT as TTYD_INSTALL_SCRIPT } from '../container-injections/ttyd.ts';
import { EXTENSION_ID as CLAUDE_CODE_EXTENSION_ID } from '../container-injections/claude-code-ide-extension.ts';
import {
	CODE_SERVER_PORT,
	DEFAULT_IMAGE,
	PUBLISH_HOST,
	TTYD_PORT,
	devcontainerBin,
	dockerEnv
} from './config.server.ts';
import { spawnCapture } from './spawn.server.ts';
import type { InstanceMode } from './db.server.ts';
import type { PortForward } from '../types.ts';

const CODE_SERVER_FEATURE = 'ghcr.io/coder/devcontainer-features/code-server:1';

/** Installs the Claude Code CLI into the default image. Needs Node — supplied by NODE_FEATURE. */
const CLAUDE_CODE_FEATURE = 'ghcr.io/anthropics/devcontainer-features/claude-code:1.0';

/** Node.js — required by the Claude Code feature, which no longer bundles it. */
const NODE_FEATURE = 'ghcr.io/devcontainers/features/node:1';

/** GitHub CLI (`gh`) — the default image doesn't ship it. Paired with the github-credentials injection. */
const GITHUB_CLI_FEATURE = 'ghcr.io/devcontainers/features/github-cli:1';

const CODE_SERVER_SETTINGS_FILE = 'code-server-settings.json';

/** Relative to .devcontainer/. */
const TMUX_FEATURE_DIR = 'codebay-tmux';

const TMUX_FEATURE_METADATA = {
	id: 'codebay-tmux',
	version: '1.0.0',
	name: 'tmux (Codebay, best-effort)',
	description:
		'Installs tmux at image build time so the Terminal task can run in a persistent session. Never fails the build.'
};

/**
 * Build time is the only reliable moment to fetch packages in a container that
 * firewalls egress after start; failures are swallowed so this can't break a build.
 */
const TMUX_FEATURE_INSTALL =
	'#!/bin/sh\n' +
	'(\n' +
	`${TMUX_INSTALL_SCRIPT}\n` +
	') || echo "codebay-tmux: install failed (non-fatal); the manager retries after the container starts"\n' +
	'exit 0\n';

/** Relative to .devcontainer/. Only written for terminal-mode instances. */
const TTYD_FEATURE_DIR = 'codebay-ttyd';

const TTYD_FEATURE_METADATA = {
	id: 'codebay-ttyd',
	version: '1.0.0',
	name: 'ttyd (Codebay, best-effort)',
	description:
		'Installs ttyd at image build time so the terminal is reachable in a firewalled container. Never fails the build.'
};

/** Best-effort like tmux: build time is the only reliable moment to fetch in an egress-firewalled container. */
const TTYD_FEATURE_INSTALL =
	'#!/bin/sh\n' +
	'(\n' +
	`${TTYD_INSTALL_SCRIPT}\n` +
	') || echo "codebay-ttyd: install failed (non-fatal); the manager retries after the container starts"\n' +
	'exit 0\n';

/** Manager-dropped files the project's own .gitignore won't cover, kept out of git status. */
const MANAGER_GIT_EXCLUDES = [
	'/.devcontainer/code-server-settings.json',
	'/.devcontainer/devcontainer-lock.json',
	'/.devcontainer/codebay-tmux/',
	'/.devcontainer/codebay-ttyd/',
	'/.devcontainer/codebay-terminal.sh',
	'/.vscode/tasks.json'
];

/** Bound the manager-owned block so a rebuild can replace it without touching the user's own lines. */
const EXCLUDE_MARKER_START = '# >>> codebay (auto-generated) >>>';
const EXCLUDE_MARKER_END = '# <<< codebay <<<';

const CODE_SERVER_SETTINGS = {
	'workbench.colorTheme': 'Default Dark Modern',
	// Stop VS Code re-resolving the theme from the OS/browser color scheme at runtime —
	// that re-resolution (fired on focus/tab-switch) is what randomly flips the editor to
	// light. Pinning both preferred themes to dark keeps either branch dark even if it does.
	'window.autoDetectColorScheme': false,
	'window.autoDetectHighContrast': false,
	'workbench.preferredDarkColorTheme': 'Default Dark Modern',
	'workbench.preferredLightColorTheme': 'Default Dark Modern',
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'chat.commandCenter.enabled': false,
	// Instances are throwaway sandboxes — never nag to install recommended extensions.
	'extensions.ignoreRecommendations': true,
	'task.allowAutomaticTasks': 'on',
	// Automatic tasks are gated behind Workspace Trust, which the bare default image lacks.
	'security.workspace.trust.enabled': false,
	'security.workspace.trust.startupPrompt': 'never',
	'security.workspace.trust.banner': 'never',
	// The browser intercepts Ctrl+Shift+V for devtools, so this is the usable clipboard path.
	'terminal.integrated.copyOnSelection': true,
	'terminal.integrated.rightClickBehavior': 'paste'
};

const TMUX_SESSION = 'codebay';

/** The split view's right-hand pane: a plain shell, kept apart from the Claude session. */
const TMUX_SHELL_SESSION = 'codebay-shell';

/** Written to `$HOME` when the post-up injection sequence finishes; the terminal launcher waits on it. */
export const INJECTIONS_DONE_FILE = '.codebay-injections-done';

/**
 * An auto-launched `claude` that starts mid-injection reads `~/.claude.json` before the trust
 * keys land and clobbers them on its next rewrite, so hold it until the sentinel appears.
 * Bounded so a failed boot (sentinel never written) still yields a usable terminal.
 */
const WAIT_FOR_INJECTIONS =
	`[ -e "$HOME/${INJECTIONS_DONE_FILE}" ] || echo "Waiting for codebay setup to finish…"; ` +
	`i=0; until [ -e "$HOME/${INJECTIONS_DONE_FILE}" ] || [ "$i" -ge 60 ]; do sleep 1; i=$((i + 1)); done; `;

/**
 * claude scans `~/.claude/ide/*.lock` once at startup and never retries, so it must not race
 * the code-server extension host writing that lock — hold it briefly until the bridge appears.
 * Bounded so an offline/uninstalled instance (lock never written) still yields a usable terminal.
 * No single quotes: this is spliced into the single-quoted tmux command string below. The probe
 * pipes ls through grep instead of globbing — tmux runs this under the user's default shell, and
 * zsh prints "no matches found" to the terminal on every unmatched-glob iteration.
 */
const WAIT_FOR_IDE_BRIDGE = `i=0; until ls "$HOME/.claude/ide/" 2>/dev/null | grep -q "\\.lock$" || [ "$i" -ge 30 ]; do sleep 1; i=$((i + 1)); done; `;

/**
 * Runs under tmux so Claude survives the browser closing — code-server reaps the
 * detached PTY, which only kills the tmux client. `-A` doubles as the run-once gate.
 */
const TERMINAL_TASK = {
	label: 'Terminal',
	type: 'shell',
	command:
		// `"$SHELL"` must reach tmux unexpanded; VS Code would substitute a `${…}` form first.
		`if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -s ${TMUX_SESSION} '${WAIT_FOR_INJECTIONS}${WAIT_FOR_IDE_BRIDGE}claude --dangerously-skip-permissions; exec "$SHELL" -l'; fi; ` +
		// Without tmux there's no run-once gate, and folderOpen re-fires on every workspace load.
		'MARK="$HOME/.codebay-terminal-launched"; [ -e "$MARK" ] && exit 0; touch "$MARK"; ' +
		WAIT_FOR_INJECTIONS +
		WAIT_FOR_IDE_BRIDGE +
		'claude --dangerously-skip-permissions; exec ${env:SHELL} -l',
	presentation: { reveal: 'always', panel: 'shared', focus: true },
	runOptions: { runOn: 'folderOpen' },
	problemMatcher: []
};

const CODE_SERVER_APPLY_SETTINGS =
	`mkdir -p ~/.local/share/code-server/User && ` +
	`cp -f \\"$PWD/.devcontainer/${CODE_SERVER_SETTINGS_FILE}\\" ` +
	`~/.local/share/code-server/User/settings.json 2>/dev/null;`;

// Runs before code-server first launches so the extension host activates it on the first window
// (the /ide bridge, in-container over localhost); best-effort, offline-tolerant, skipped if present.
const CODE_SERVER_INSTALL_EXT =
	`ls -d ~/.local/share/code-server/extensions/${CLAUDE_CODE_EXTENSION_ID}-* >/dev/null 2>&1 || ` +
	`code-server --install-extension ${CLAUDE_CODE_EXTENSION_ID} >/tmp/code-server-ext.log 2>&1 || true; `;

const CODE_SERVER_LAUNCH =
	`bash -c "${CODE_SERVER_APPLY_SETTINGS} ` +
	`${CODE_SERVER_INSTALL_EXT} ` +
	// The bare default image may not export SHELL, which the Terminal task needs.
	`export SHELL=\\"\${SHELL:-/bin/bash}\\"; ` +
	`pgrep -f 'code-server.*${CODE_SERVER_PORT}' >/dev/null 2>&1 || ` +
	`nohup code-server --bind-addr 0.0.0.0:${CODE_SERVER_PORT} --auth none ` +
	`--disable-workspace-trust \\"$PWD\\" >/tmp/code-server.log 2>&1 &"`;

/** Staged next to the config; ttyd runs it as its command so the nested quoting stays in a real file. */
const TTYD_LAUNCH_SCRIPT_FILE = 'codebay-terminal.sh';

/** The one `?arg=` value ttyd is allowed to act on; anything else falls through to Claude. */
export const TTYD_SHELL_ARG = 'shell';

/**
 * ttyd runs this per browser connection. `tmux -A` attaches to the shared `codebay` session
 * (or creates it), so Claude survives reconnects. No WAIT_FOR_IDE_BRIDGE — terminal mode has
 * no code-server extension host to race. Kept in a file so the tmux command's own quoting isn't
 * nested inside the postStartCommand's shell quoting.
 *
 * `$1` comes from the URL's `?arg=` (ttyd's --url-arg), so it is untrusted — hence a literal
 * compare and never an eval. The shell branch sits above the injections wait so the split view's
 * scratch shell opens immediately instead of blocking on Claude's boot sentinel.
 */
const TTYD_LAUNCH_SCRIPT =
	'#!/usr/bin/env bash\n' +
	'export SHELL="${SHELL:-/bin/bash}"\n' +
	`if [ "$1" = "${TTYD_SHELL_ARG}" ]; then\n` +
	'  if command -v tmux >/dev/null 2>&1; then\n' +
	`    exec tmux new-session -A -s ${TMUX_SHELL_SESSION}\n` +
	'  fi\n' +
	'  exec "$SHELL" -l\n' +
	'fi\n' +
	WAIT_FOR_INJECTIONS +
	'\n' +
	`if command -v tmux >/dev/null 2>&1; then\n` +
	`  exec tmux new-session -A -s ${TMUX_SESSION} 'claude --dangerously-skip-permissions; exec "$SHELL" -l'\n` +
	'fi\n' +
	'claude --dangerously-skip-permissions\n' +
	'exec "$SHELL" -l\n';

// ttyd defaults to read-only, so --writable is required for keyboard input. Guarded by `pgrep -x`
// (process name) so a folderOpen/rebuild can't stack a second daemon — never `pgrep -f`, whose
// cmdline match also matches this very shell, which would skip the launch every time.
const TTYD_LAUNCH =
	`bash -c "` +
	`export SHELL=\\"\${SHELL:-/bin/bash}\\"; ` +
	`command -v ttyd >/dev/null 2>&1 || exit 0; ` +
	`pgrep -x ttyd >/dev/null 2>&1 || ` +
	// ttyd binds all interfaces by default; --interface expects an iface NAME (e.g. eth0), not
	// an IP, so passing 0.0.0.0 makes it fail to start. -W/--writable is required for input.
	// --url-arg forwards the connection URL's `?arg=` values into the launcher's argv, which is how
	// one ttyd serves both the Claude session and the split view's scratch shell.
	`nohup ttyd --port ${TTYD_PORT} --writable --url-arg ` +
	`bash \\"$PWD/.devcontainer/${TTYD_LAUNCH_SCRIPT_FILE}\\" >/tmp/ttyd.log 2>&1 &"`;

export async function devcontainerCliAvailable(): Promise<boolean> {
	return (await spawnCapture([devcontainerBin(), '--version'])) !== null;
}

export async function copyWorkspace(
	source: string,
	dest: string,
	ignore: Set<string>
): Promise<void> {
	await mkdir(dest, { recursive: true });
	await cp(source, dest, {
		recursive: true,
		dereference: false,
		filter: (src) => !ignore.has(basename(src))
	});
}

/** Strip // and /* *\/ comments and trailing commas from JSONC, respecting string literals. */
function stripJsonc(input: string): string {
	let out = '';
	let inString = false;
	let inLine = false;
	let inBlock = false;
	// Tracked inline rather than by regex, so commas inside string values are never touched.
	let lastComma = -1;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		const next = input[i + 1];
		if (inLine) {
			if (ch === '\n') {
				inLine = false;
				out += ch;
			}
			continue;
		}
		if (inBlock) {
			if (ch === '*' && next === '/') {
				inBlock = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === '\\') {
				out += next ?? '';
				i++;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			lastComma = -1;
			continue;
		}
		if (ch === '/' && next === '/') {
			inLine = true;
			i++;
			continue;
		}
		if (ch === '/' && next === '*') {
			inBlock = true;
			i++;
			continue;
		}
		if (ch === ',') {
			out += ch;
			lastComma = out.length - 1;
			continue;
		}
		if (ch === '}' || ch === ']') {
			if (lastComma !== -1) {
				out = out.slice(0, lastComma) + out.slice(lastComma + 1);
				lastComma = -1;
			}
			out += ch;
			continue;
		}
		out += ch;
		// Whitespace and stripped comments must not clear the pending comma, but real tokens do.
		if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') lastComma = -1;
	}
	return out;
}

/** Follows the CLI's precedence: `.devcontainer/devcontainer.json`, then `.devcontainer.json`. */
export function findDevcontainerConfig(dir: string): string | null {
	const nested = join(dir, '.devcontainer', 'devcontainer.json');
	if (existsSync(nested)) return nested;
	const flat = join(dir, '.devcontainer.json');
	if (existsSync(flat)) return flat;
	return null;
}

function configPath(workspaceDir: string): string {
	// Falls back to the nested path because that's where we'd create one.
	return (
		findDevcontainerConfig(workspaceDir) ?? join(workspaceDir, '.devcontainer', 'devcontainer.json')
	);
}

type DevcontainerConfig = {
	image?: string;
	features?: Record<string, unknown>;
	appPort?: number | string | (number | string)[];
	forwardPorts?: (number | string)[];
	postStartCommand?: unknown;
	runArgs?: string[];
	[key: string]: unknown;
};

/** An entry may be a bare port or a `host:container` string. */
function containerPortOf(entry: number | string): number {
	if (typeof entry === 'number') return entry;
	const last = entry.split(':').pop() ?? '';
	return Number.parseInt(last, 10);
}

/** Only meaningful on a pristine, pre-injection config; code-server's own port is excluded. */
export async function readDeclaredContainerPorts(workspaceDir: string): Promise<number[]> {
	const target = configPath(workspaceDir);
	if (!existsSync(target)) return [];
	let config: DevcontainerConfig;
	try {
		config = JSON.parse(stripJsonc(await readFile(target, 'utf8'))) as DevcontainerConfig;
	} catch {
		return []; // unparseable here surfaces as a clear error later in writeOverrideConfig
	}

	const entries: (number | string)[] = [];
	if (Array.isArray(config.forwardPorts)) entries.push(...config.forwardPorts);
	if (Array.isArray(config.appPort)) entries.push(...config.appPort);
	else if (config.appPort !== undefined) entries.push(config.appPort);

	const ports = new Set<number>();
	for (const entry of entries) {
		const port = containerPortOf(entry);
		// Both reserved internal ports are excluded regardless of mode, so neither can be
		// double-mapped when writeOverrideConfig renders its own appPort entry for it.
		if (
			Number.isInteger(port) &&
			port > 0 &&
			port <= 65535 &&
			port !== CODE_SERVER_PORT &&
			port !== TTYD_PORT
		) {
			ports.add(port);
		}
	}
	return [...ports];
}

/** Maps `host.docker.internal` to the host so the in-container attention bridge resolves. */
const HOST_GATEWAY_ARG = '--add-host=host.docker.internal:host-gateway';

/** Operates on the copy, never the user's original, so rewriting and normalizing is safe. */
export async function writeOverrideConfig(
	workspaceDir: string,
	hostPort: number,
	forwards: PortForward[] = [],
	defaultImage: string = DEFAULT_IMAGE,
	mode: InstanceMode = 'ide'
): Promise<{ imageSource: string }> {
	const isTerminal = mode === 'terminal';
	const target = configPath(workspaceDir);
	let config: DevcontainerConfig = {};

	const hadConfig = existsSync(target);
	const imageSource = hadConfig ? 'local' : defaultImage;

	if (hadConfig) {
		const raw = await readFile(target, 'utf8');
		try {
			config = JSON.parse(stripJsonc(raw)) as DevcontainerConfig;
		} catch (err) {
			throw new Error(
				`Could not parse existing devcontainer.json at ${target}: ${(err as Error).message}`,
				{ cause: err }
			);
		}
	} else {
		config.image = defaultImage;
	}

	// A local feature is addressed relative to the config, which sits at one of two depths.
	const featureKey = (dir: string) =>
		`./${relative(dirname(target), join(workspaceDir, '.devcontainer', dir))}`;
	const tmuxFeatureKey = featureKey(TMUX_FEATURE_DIR);
	const ttydFeatureKey = featureKey(TTYD_FEATURE_DIR);

	// Terminal mode swaps code-server for ttyd; everything else (tmux, tooling) is identical.
	// Node/Claude/gh only for the default image — projects with their own config own their tooling.
	config.features = {
		...(config.features ?? {}),
		...(isTerminal
			? { [ttydFeatureKey]: {} }
			: { [CODE_SERVER_FEATURE]: { host: '0.0.0.0', port: CODE_SERVER_PORT, auth: 'none' } }),
		[tmuxFeatureKey]: {},
		...(hadConfig
			? {}
			: { [NODE_FEATURE]: {}, [CLAUDE_CODE_FEATURE]: {}, [GITHUB_CLI_FEATURE]: {} })
	};

	const servedPort = isTerminal ? TTYD_PORT : CODE_SERVER_PORT;
	// Rendered from scratch rather than merged, so removing a forward actually drops its mapping.
	// The served port stays loopback even under HOST=0.0.0.0 — neither code-server nor ttyd has
	// auth of its own, so the LAN reaches it only through the Basic-Auth-gated /p/:id/ proxy.
	config.appPort = [
		`127.0.0.1:${hostPort}:${servedPort}`,
		...forwards.map((f) => `${PUBLISH_HOST}:${f.host_port}:${f.container_port}`)
	];

	// host.docker.internal isn't automatic on Colima/Linux Docker.
	const runArgs = new Set(Array.isArray(config.runArgs) ? config.runArgs : []);
	runArgs.add(HOST_GATEWAY_ARG);
	config.runArgs = [...runArgs];

	const launch = isTerminal ? TTYD_LAUNCH : CODE_SERVER_LAUNCH;
	const existing = config.postStartCommand;
	config.postStartCommand =
		typeof existing === 'string' && existing.trim() ? `${existing} && ${launch}` : launch;

	await mkdir(join(workspaceDir, '.devcontainer'), { recursive: true }).catch(() => {});
	await writeFile(target, JSON.stringify(config, null, 2) + '\n', 'utf8');

	if (isTerminal) {
		await writeTtydFeature(workspaceDir);
		await writeTerminalLaunchScript(workspaceDir);
	} else {
		// Staged next to the config; CODE_SERVER_LAUNCH copies it into the user-data dir on first start.
		await writeFile(
			join(workspaceDir, '.devcontainer', CODE_SERVER_SETTINGS_FILE),
			JSON.stringify(CODE_SERVER_SETTINGS, null, 2) + '\n',
			'utf8'
		);
		// The VS Code Terminal task is code-server-only; ttyd runs its own launcher script instead.
		await writeTerminalTask(workspaceDir);
	}

	await writeTmuxFeature(workspaceDir);

	await writeLocalGitExclude(workspaceDir);

	return { imageSource };
}

/**
 * The container has no global gitignore, so files the host hides globally would
 * otherwise surface in its git status. Mirrors git's own resolution order.
 */
async function readHostGlobalExcludes(): Promise<string> {
	const expand = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
	const configured = await spawnCapture([
		'git',
		'config',
		'--global',
		'--get',
		'core.excludesFile'
	]);
	const path = configured
		? expand(configured)
		: process.env.XDG_CONFIG_HOME
			? join(process.env.XDG_CONFIG_HOME, 'git', 'ignore')
			: join(homedir(), '.config', 'git', 'ignore');
	if (!existsSync(path)) return '';
	try {
		return await readFile(path, 'utf8');
	} catch {
		return '';
	}
}

function stripManagedBlock(text: string): string {
	const start = text.indexOf(EXCLUDE_MARKER_START);
	if (start === -1) return text;
	const endMarker = text.indexOf(EXCLUDE_MARKER_END, start);
	// A truncated block (no closing marker) is dropped from the opening marker onward.
	if (endMarker === -1) return text.slice(0, start);
	return text.slice(0, start) + text.slice(endMarker + EXCLUDE_MARKER_END.length);
}

/** Uses `.git/info/exclude` rather than `.gitignore` so the project's own file stays untouched. */
async function writeLocalGitExclude(workspaceDir: string): Promise<void> {
	const gitDir = join(workspaceDir, '.git');
	// Only a real .git directory has info/exclude; a submodule/worktree .git file doesn't.
	if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return;

	const infoDir = join(gitDir, 'info');
	const excludePath = join(infoDir, 'exclude');

	let existing = '';
	if (existsSync(excludePath)) {
		try {
			existing = await readFile(excludePath, 'utf8');
		} catch {
			existing = '';
		}
	}
	existing = stripManagedBlock(existing).trim();

	const globalExcludes = (await readHostGlobalExcludes()).trim();
	const block = [
		EXCLUDE_MARKER_START,
		'# Files the manager injects into the copied workspace.',
		...MANAGER_GIT_EXCLUDES,
		...(globalExcludes
			? ['# Replicated from the host global git excludes (core.excludesFile).', globalExcludes]
			: []),
		EXCLUDE_MARKER_END,
		''
	].join('\n');

	await mkdir(infoDir, { recursive: true }).catch(() => {});
	await writeFile(excludePath, existing ? `${existing}\n\n${block}` : block, 'utf8');
}

async function writeTmuxFeature(workspaceDir: string): Promise<void> {
	const dir = join(workspaceDir, '.devcontainer', TMUX_FEATURE_DIR);
	await mkdir(dir, { recursive: true }).catch(() => {});
	await writeFile(
		join(dir, 'devcontainer-feature.json'),
		JSON.stringify(TMUX_FEATURE_METADATA, null, 2) + '\n',
		'utf8'
	);
	const installPath = join(dir, 'install.sh');
	await writeFile(installPath, TMUX_FEATURE_INSTALL, 'utf8');
	// writeFile's mode only applies on creation; chmod covers rewrites too.
	await chmod(installPath, 0o755);
}

async function writeTtydFeature(workspaceDir: string): Promise<void> {
	const dir = join(workspaceDir, '.devcontainer', TTYD_FEATURE_DIR);
	await mkdir(dir, { recursive: true }).catch(() => {});
	await writeFile(
		join(dir, 'devcontainer-feature.json'),
		JSON.stringify(TTYD_FEATURE_METADATA, null, 2) + '\n',
		'utf8'
	);
	const installPath = join(dir, 'install.sh');
	await writeFile(installPath, TTYD_FEATURE_INSTALL, 'utf8');
	await chmod(installPath, 0o755);
}

/** Staged next to the config; TTYD_LAUNCH runs it as ttyd's command. */
async function writeTerminalLaunchScript(workspaceDir: string): Promise<void> {
	const path = join(workspaceDir, '.devcontainer', TTYD_LAUNCH_SCRIPT_FILE);
	await writeFile(path, TTYD_LAUNCH_SCRIPT, 'utf8');
	await chmod(path, 0o755);
}

/** Replaces the managed task rather than skipping it, so a rebuild picks up command changes. */
async function writeTerminalTask(workspaceDir: string): Promise<void> {
	const tasksPath = join(workspaceDir, '.vscode', 'tasks.json');
	let config: { version?: string; tasks?: unknown[] } = {};

	if (existsSync(tasksPath)) {
		try {
			config = JSON.parse(stripJsonc(await readFile(tasksPath, 'utf8')));
		} catch {
			config = {};
		}
	}

	config.version = config.version ?? '2.0.0';
	const tasks = Array.isArray(config.tasks) ? config.tasks : [];

	const isManagedTask = (t: unknown) =>
		typeof t === 'object' &&
		t !== null &&
		(t as Record<string, unknown>).label === TERMINAL_TASK.label &&
		((t as Record<string, { runOn?: string }>).runOptions?.runOn ?? '') === 'folderOpen';
	config.tasks = [...tasks.filter((t) => !isManagedTask(t)), TERMINAL_TASK];

	await mkdir(join(workspaceDir, '.vscode'), { recursive: true }).catch(() => {});
	await writeFile(tasksPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export interface UpResult {
	outcome: string;
	containerId?: string;
	remoteUser?: string;
	remoteWorkspaceFolder?: string;
	message?: string;
	description?: string;
}

/** Streams all output to `onLog` and returns the parsed final result line. */
export async function devcontainerUp(
	workspaceDir: string,
	onLog: (chunk: string) => void,
	opts: { noCache?: boolean } = {}
): Promise<UpResult> {
	const args = [
		devcontainerBin(),
		'up',
		'--workspace-folder',
		workspaceDir,
		'--remove-existing-container'
	];
	// Only takes effect because --remove-existing-container drops the container before the build.
	if (opts.noCache) args.push('--build-no-cache');
	const proc = Bun.spawn(args, {
		cwd: workspaceDir,
		stdout: 'pipe',
		stderr: 'pipe',
		env: dockerEnv()
	});

	let stdoutText = '';
	const pump = async (stream: ReadableStream<Uint8Array>, capture: boolean) => {
		const decoder = new TextDecoder();
		for await (const bytes of stream) {
			const text = decoder.decode(bytes, { stream: true });
			if (capture) stdoutText += text;
			onLog(text);
		}
	};

	await Promise.all([pump(proc.stdout, true), pump(proc.stderr, false)]);
	await proc.exited;

	// The CLI prints log lines plus a final JSON result; find the last JSON object.
	const lines = stdoutText
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line && line.startsWith('{')) {
			try {
				return JSON.parse(line) as UpResult;
			} catch {
				// keep scanning earlier lines
			}
		}
	}
	throw new Error('devcontainer up did not return a result. See logs for details.');
}
