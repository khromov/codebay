import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import {
	CODE_SERVER_PORT,
	COPY_IGNORE,
	DEFAULT_IMAGE,
	devcontainerBin,
	dockerEnv
} from './config.server.ts';
import { spawnCapture } from './spawn.server.ts';
import type { PortForward } from '../types.ts';

const CODE_SERVER_FEATURE = 'ghcr.io/coder/devcontainer-features/code-server:1';

/** Installs the Claude Code CLI into the default image. Needs Node — supplied by NODE_FEATURE. */
const CLAUDE_CODE_FEATURE = 'ghcr.io/anthropics/devcontainer-features/claude-code:1.0';

/** Node.js — required by the Claude Code feature, which no longer bundles it. */
const NODE_FEATURE = 'ghcr.io/devcontainers/features/node:1';

/** GitHub CLI (`gh`) — the default image doesn't ship it. Paired with the github-credentials injection. */
const GITHUB_CLI_FEATURE = 'ghcr.io/devcontainers/features/github-cli:1';

/** Where the override config file is staged inside the copied workspace. */
const CODE_SERVER_SETTINGS_FILE = 'code-server-settings.json';

/**
 * Repo-root-anchored paths for files the manager (or the devcontainer CLI) drops into the copied
 * workspace but that the project's own .gitignore doesn't cover. Seeded into the copy's
 * .git/info/exclude so they don't surface as stray changes in the container's git status.
 * Excludes only affect untracked files, so listing an already-tracked path is a harmless no-op.
 */
const MANAGER_GIT_EXCLUDES = [
	'/.devcontainer/code-server-settings.json',
	'/.devcontainer/devcontainer-lock.json',
	'/.vscode/tasks.json'
];

/** Markers bounding the manager-owned block in .git/info/exclude, so it's replaceable across rebuilds. */
const EXCLUDE_MARKER_START = '# >>> devcontainers-manager (auto-generated) >>>';
const EXCLUDE_MARKER_END = '# <<< devcontainers-manager <<<';

/** Default code-server (VS Code) user settings: dark theme, no agent chat panel. */
const CODE_SERVER_SETTINGS = {
	'workbench.colorTheme': 'Default Dark Modern',
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'chat.commandCenter.enabled': false,
	// Run the folderOpen Terminal task (below) without prompting on first open.
	'task.allowAutomaticTasks': 'on',
	// Defeat restricted mode (Workspace Trust) so the folderOpen task can run — automatic
	// tasks are gated behind trust, and the bare default image isn't trusted by default.
	'security.workspace.trust.enabled': false,
	'security.workspace.trust.startupPrompt': 'never',
	'security.workspace.trust.banner': 'never'
};

/**
 * Auto-launches Claude Code when the workspace folder opens in code-server, then
 * drops to an interactive login shell once Claude exits so the terminal stays usable.
 * `--dangerously-skip-permissions` matches the in-container alias (instances are
 * throwaway single-tenant sandboxes); invoked directly here since the alias only
 * loads in interactive shells and this task's command runs non-interactively.
 *
 * Gated to the *first* open: VS Code re-runs a `folderOpen` task on every workspace
 * load (each reload/revisit), and there's no built-in run-once option, so the command
 * itself checks/creates a marker file and `exit 0`s on subsequent opens (no relaunch).
 * The marker lives in the container home dir, so it survives code-server reloads but
 * resets on a rebuild (fresh container) — the terminal then auto-launches once more.
 */
const TERMINAL_TASK = {
	label: 'Terminal',
	type: 'shell',
	command:
		'MARK="$HOME/.dcm-terminal-launched"; [ -e "$MARK" ] && exit 0; touch "$MARK"; ' +
		'claude --dangerously-skip-permissions; exec ${env:SHELL} -l',
	presentation: { reveal: 'always', panel: 'shared', focus: true },
	runOptions: { runOn: 'folderOpen' },
	problemMatcher: []
};

/** Copy the staged settings into code-server's user-data dir before first launch. */
const CODE_SERVER_APPLY_SETTINGS =
	`mkdir -p ~/.local/share/code-server/User && ` +
	`cp -f \\"$PWD/.devcontainer/${CODE_SERVER_SETTINGS_FILE}\\" ` +
	`~/.local/share/code-server/User/settings.json 2>/dev/null;`;

/** Launch code-server on every container start, idempotently, bound for host access. */
const CODE_SERVER_LAUNCH =
	`bash -c "${CODE_SERVER_APPLY_SETTINGS} ` +
	// Guarantee SHELL is set so the Terminal task's `exec ${env:SHELL} -l` resolves on the
	// bare default image (which may not export it); honors the user's shell when present.
	`export SHELL=\\"\${SHELL:-/bin/bash}\\"; ` +
	`pgrep -f 'code-server.*${CODE_SERVER_PORT}' >/dev/null 2>&1 || ` +
	`nohup code-server --bind-addr 0.0.0.0:${CODE_SERVER_PORT} --auth none ` +
	`--disable-workspace-trust \\"$PWD\\" >/tmp/code-server.log 2>&1 &"`;

/** Whether the bundled @devcontainers/cli binary is runnable. */
export async function devcontainerCliAvailable(): Promise<boolean> {
	return (await spawnCapture([devcontainerBin(), '--version'])) !== null;
}

/** Recursively copy a source folder into the instance workspace, skipping COPY_IGNORE dirs. */
export async function copyWorkspace(source: string, dest: string): Promise<void> {
	await mkdir(dest, { recursive: true });
	await cp(source, dest, {
		recursive: true,
		dereference: false,
		filter: (src) => !COPY_IGNORE.has(basename(src))
	});
}

/** Strip // and /* *\/ comments and trailing commas from JSONC, respecting string literals. */
function stripJsonc(input: string): string {
	let out = '';
	let inString = false;
	let inLine = false;
	let inBlock = false;
	// Index in `out` of the last comma emitted outside a string, pending a
	// possible drop. Tracked inline (not via a blind regex over the whole output)
	// so commas inside string values — e.g. "echo {a,}" — are never touched.
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
			// Drop a trailing comma sitting between here and the last value.
			if (lastComma !== -1) {
				out = out.slice(0, lastComma) + out.slice(lastComma + 1);
				lastComma = -1;
			}
			out += ch;
			continue;
		}
		out += ch;
		// Any non-whitespace token other than a comma clears the pending comma;
		// whitespace (and stripped comments) between a comma and its closer keep it.
		if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') lastComma = -1;
	}
	return out;
}

/**
 * The devcontainer.json a folder already has, following the CLI's precedence
 * (`.devcontainer/devcontainer.json`, then `.devcontainer.json`), or null if it
 * has neither. Single source of truth for the "does this folder have a
 * devcontainer config, and where" convention.
 */
export function findDevcontainerConfig(dir: string): string | null {
	const nested = join(dir, '.devcontainer', 'devcontainer.json');
	if (existsSync(nested)) return nested;
	const flat = join(dir, '.devcontainer.json');
	if (existsSync(flat)) return flat;
	return null;
}

/** Find the devcontainer.json the CLI would use for a workspace folder. */
function configPath(workspaceDir: string): string {
	// Default to the nested path when the folder has none — that's where we create it.
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

/** Container port from an `appPort`/`forwardPorts` entry: a number, or the last `:`-segment of a string. */
function containerPortOf(entry: number | string): number {
	if (typeof entry === 'number') return entry;
	const last = entry.split(':').pop() ?? '';
	return Number.parseInt(last, 10);
}

/**
 * Read the container ports a project *declares* it wants forwarded, from a pristine
 * (pre-injection) devcontainer.json: `forwardPorts` plus any `appPort` entries. Returns a
 * deduped list with code-server's own port excluded — these become the seeded forwards.
 */
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
		if (Number.isInteger(port) && port > 0 && port <= 65535 && port !== CODE_SERVER_PORT) {
			ports.add(port);
		}
	}
	return [...ports];
}

/** Maps `host.docker.internal` to the host so the in-container attention bridge resolves. */
const HOST_GATEWAY_ARG = '--add-host=host.docker.internal:host-gateway';

/**
 * Inject code-server + the published host ports into the copied workspace's devcontainer.json,
 * creating a default-image config if the folder has none. Operates on the copy, so
 * rewriting/normalizing the file is safe.
 *
 * `appPort` is rendered *deterministically* from `hostPort` (code-server) plus `forwards` — it
 * deliberately discards whatever the file held, so removing a forward actually drops its mapping.
 * The project's own declared ports are preserved because they're captured as forwards upstream
 * (see `readDeclaredContainerPorts` / `seedDeclaredPorts`).
 */
export async function writeOverrideConfig(
	workspaceDir: string,
	hostPort: number,
	forwards: PortForward[] = [],
	defaultImage: string = DEFAULT_IMAGE
): Promise<{ imageSource: string }> {
	const target = configPath(workspaceDir);
	let config: DevcontainerConfig = {};

	// 'local' when the folder shipped its own devcontainer.json; otherwise the image we inject.
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

	// Install code-server. When we generated the default config (no project devcontainer.json),
	// also install Node + Claude Code + the GitHub CLI — the base image doesn't ship them, and the
	// credentials + attention hooks injected post-up need a `claude` binary to drive (which in turn
	// needs Node) and a `gh` binary to authorize. Projects with their own config manage their own
	// tooling, so these are only added for the default image. The devcontainer CLI resolves install
	// order from feature metadata.
	config.features = {
		...(config.features ?? {}),
		[CODE_SERVER_FEATURE]: { host: '0.0.0.0', port: CODE_SERVER_PORT, auth: 'none' },
		...(hadConfig
			? {}
			: { [NODE_FEATURE]: {}, [CLAUDE_CODE_FEATURE]: {}, [GITHUB_CLI_FEATURE]: {} })
	};

	// Publish code-server plus each forwarded port on its unique host port, bound to
	// loopback. code-server stays reachable solely via the authed Mochi proxy; forwarded
	// app ports are opened for direct `http://localhost:<host_port>` access.
	config.appPort = [
		`127.0.0.1:${hostPort}:${CODE_SERVER_PORT}`,
		...forwards.map((f) => `127.0.0.1:${f.host_port}:${f.container_port}`)
	];

	// Ensure host.docker.internal resolves inside the container (it isn't automatic on
	// Colima/Linux Docker) so the Claude attention hook can reach the manager.
	const runArgs = new Set(Array.isArray(config.runArgs) ? config.runArgs : []);
	runArgs.add(HOST_GATEWAY_ARG);
	config.runArgs = [...runArgs];

	// Launch code-server on container start, chaining any existing postStartCommand.
	const existing = config.postStartCommand;
	config.postStartCommand =
		typeof existing === 'string' && existing.trim()
			? `${existing} && ${CODE_SERVER_LAUNCH}`
			: CODE_SERVER_LAUNCH;

	await mkdir(join(workspaceDir, '.devcontainer'), { recursive: true }).catch(() => {});
	await writeFile(target, JSON.stringify(config, null, 2) + '\n', 'utf8');

	// Stage the code-server user settings next to the config; the launcher copies
	// them into the container's user-data dir on first start.
	await writeFile(
		join(workspaceDir, '.devcontainer', CODE_SERVER_SETTINGS_FILE),
		JSON.stringify(CODE_SERVER_SETTINGS, null, 2) + '\n',
		'utf8'
	);

	await writeTerminalTask(workspaceDir);

	// Keep the container's `git status` clean: hide the files we just injected plus anything the
	// host only ignores via its global excludes (the container has no global gitignore).
	await writeLocalGitExclude(workspaceDir);

	return { imageSource };
}

/**
 * The host's global git excludes (`core.excludesFile`) contents, so we can replicate them into the
 * copied workspace. The container has no global gitignore, so files the host hides globally (e.g. a
 * nested `.claude/settings.local.json`) would otherwise surface in the container's git status.
 * Mirrors git's own resolution: an explicit `core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore`
 * (or `~/.config/git/ignore`). Best-effort — returns '' when unset, missing, or unreadable.
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

/** Remove a previously-written manager block (inclusive of its markers) from an exclude file's text. */
function stripManagedBlock(text: string): string {
	const start = text.indexOf(EXCLUDE_MARKER_START);
	if (start === -1) return text;
	const endMarker = text.indexOf(EXCLUDE_MARKER_END, start);
	// A truncated block (no closing marker) is dropped from the opening marker onward.
	if (endMarker === -1) return text.slice(0, start);
	return text.slice(0, start) + text.slice(endMarker + EXCLUDE_MARKER_END.length);
}

/**
 * Seed the copied workspace's `.git/info/exclude` with the manager's own artifacts plus a replica of
 * the host's global git excludes, so the container's `git status` isn't polluted by files the manager
 * injects or by files the host only hides via its global gitignore. Repo-local and never committed, so
 * the project's own `.gitignore` is left untouched. No-op when the copy isn't a real git repo.
 * Idempotent: a prior manager block (between markers) is replaced rather than stacked across rebuilds.
 */
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

/**
 * Merge the folderOpen Terminal task into the workspace's `.vscode/tasks.json` so a usable
 * shell opens automatically in code-server. Non-destructive: preserves any existing tasks
 * and is idempotent across rebuilds. A malformed existing tasks.json is replaced rather
 * than aborting the boot.
 */
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

	const hasTerminalTask = tasks.some(
		(t) =>
			typeof t === 'object' &&
			t !== null &&
			(t as Record<string, unknown>).label === TERMINAL_TASK.label &&
			((t as Record<string, { runOn?: string }>).runOptions?.runOn ?? '') === 'folderOpen'
	);
	if (!hasTerminalTask) tasks.push(TERMINAL_TASK);
	config.tasks = tasks;

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

/**
 * Run `devcontainer up` for a workspace, streaming all output to `onLog`,
 * and return the parsed final result line.
 */
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
	// Force a fresh image build (no BuildKit layer cache). Takes effect because we
	// pass --remove-existing-container: the container is gone before the build runs.
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
