export interface PortForward {
	container_port: number;
	host_port: number;
	/** Live per Docker; set only when serializing for the client. */
	open?: boolean;
}

/** Mirrors the server's InstanceRow minus `bridge_token`. */
export interface Instance {
	id: string;
	name: string;
	source_path: string;
	workspace_path: string;
	host_port: number;
	container_id: string | null;
	remote_workspace_folder: string | null;
	status: 'creating' | 'running' | 'stopped' | 'error';
	error: string | null;
	created_at: number;
	/** `'local'` when the folder shipped its own config; null until provisioned. */
	image_source: string | null;
	mode: InstanceMode;
	/** Terminal modes only: 1 when the scratch-shell pane was left open, so a reload restores it. */
	terminal_split: number;
	/** Polled per reconcile rather than persisted; null if unknown. */
	git_branch: string | null;
	attention: 'done' | 'waiting' | null;
	forwarded_ports: PortForward[];
}

/**
 * `'ide'` serves full code-server and `'terminal'` serves ttyd, both inside a devcontainer;
 * `'nono'` skips Docker entirely and runs Claude Code as a host process under the nono sandbox.
 */
export type InstanceMode = 'ide' | 'terminal' | 'nono';

export const INSTANCE_MODES: InstanceMode[] = ['ide', 'terminal', 'nono'];

/** Anything unrecognised falls back to the full IDE. */
export function normalizeMode(value: unknown): InstanceMode {
	return INSTANCE_MODES.includes(value as InstanceMode) ? (value as InstanceMode) : 'ide';
}

/** The non-IDE modes render an xterm pane rather than a code-server iframe. */
export function usesTerminalUi(mode: InstanceMode): boolean {
	return mode !== 'ide';
}

/** Only `'nono'` runs outside Docker, so it skips ports, health probes, rebuilds and injections. */
export function isSandboxMode(mode: InstanceMode): boolean {
	return mode === 'nono';
}

/** The permission mode Claude Code starts in. `'default'` keeps the historical bypass behaviour. */
export type ClaudePermissionMode = 'default' | 'manual' | 'auto' | 'plan';

export const CLAUDE_PERMISSION_MODES: ClaudePermissionMode[] = [
	'default',
	'manual',
	'auto',
	'plan'
];

/** Anything unrecognised falls back to the historical behaviour. */
export function normalizePermissionMode(value: unknown): ClaudePermissionMode {
	return CLAUDE_PERMISSION_MODES.includes(value as ClaudePermissionMode)
		? (value as ClaudePermissionMode)
		: 'default';
}

/** The flags every managed `claude` invocation carries — the launchers and the shell alias share them. */
export function claudePermissionFlags(mode: ClaudePermissionMode): string {
	return mode === 'default' ? '--dangerously-skip-permissions' : `--permission-mode ${mode}`;
}

/** Dashboard run-state view filter: All | Active (running/creating) | Stopped (stopped/error). */
export type InstanceFilter = 'all' | 'active' | 'stopped';

export function isInstanceFilter(v: unknown): v is InstanceFilter {
	return v === 'all' || v === 'active' || v === 'stopped';
}

/** Live only — never persisted, so it always reflects the most recent probe. */
export interface InstanceHealth {
	containerRunning: boolean;
	codeServerAccessible: boolean;
	/** One row per injection defining a `check()`; empty while the container is down. */
	injections: { id: string; label: string; ok: boolean }[];
	openPorts: number[];
	checkedAt: number;
}

export interface AuthProvider {
	id: string;
	label: string;
	available: boolean;
	/** Where the credential was found, null if absent. */
	source: string | null;
	/** Short instruction shown when absent, e.g. "run `gh auth login`". */
	hint?: string;
}

export interface Preflight {
	docker: boolean;
	cli: boolean;
	/** The `nono` binary on the host's PATH — the only dependency sandbox mode has. */
	nono: boolean;
	auth: AuthProvider[];
	/** Global default the picker's mode toggle starts on; per-instance override wins. */
	defaultMode: InstanceMode;
}

/** Sandbox mode needs no daemon, so a dead Docker must not disable instance creation outright. */
export function canCreate(preflight: Preflight, mode: InstanceMode): boolean {
	return isSandboxMode(mode) ? preflight.nono : preflight.docker && preflight.cli;
}

/** Same-origin so the app's Basic Auth covers the editor too. */
export function ideUrl(instance: Instance): string {
	const base = `/p/${instance.id}/`;
	return instance.remote_workspace_folder
		? `${base}?folder=${encodeURIComponent(instance.remote_workspace_folder)}`
		: base;
}

export interface DirEntry {
	name: string;
	path: string;
	hasDevcontainer: boolean;
}

export interface BrowseResult {
	path: string;
	hasDevcontainer: boolean;
	parent: string | null;
	entries: DirEntry[];
}

export interface FolderHistoryEntry {
	source_path: string;
	name: string;
	last_used_at: number;
}
