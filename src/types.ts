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
	/** Sprite name chosen collision-free at creation; null pre-dates this and falls back to the id hash. */
	avatar: string | null;
	/** `'ide'` serves full code-server; `'terminal'` serves only ttyd + Claude Code. */
	mode: InstanceMode;
	/** Terminal mode only: 1 when the scratch-shell pane was left open, so a reload restores it. */
	terminal_split: number;
	/** Polled per reconcile rather than persisted; null if unknown. */
	git_branch: string | null;
	attention: 'done' | 'waiting' | null;
	forwarded_ports: PortForward[];
}

/** `'ide'` serves full code-server; `'terminal'` serves only ttyd + Claude Code. */
export type InstanceMode = 'ide' | 'terminal';

/** Anything that isn't the explicit terminal opt-in falls back to the full IDE. */
export function normalizeMode(value: unknown): InstanceMode {
	return value === 'terminal' ? 'terminal' : 'ide';
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

/** Claude Code's default reasoning-effort level for new sessions, written to `settings.json`. */
export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CLAUDE_EFFORT_LEVELS: ClaudeEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Anything unrecognised falls back to the balanced default. */
export function normalizeEffortLevel(value: unknown): ClaudeEffortLevel {
	return CLAUDE_EFFORT_LEVELS.includes(value as ClaudeEffortLevel)
		? (value as ClaudeEffortLevel)
		: 'high';
}

/**
 * Claude Code's output style for new sessions, written to `settings.json` as `outputStyle`.
 * `'default'` inherits whatever the host has; `'none'` forces it off; anything else is a literal
 * Claude output-style name — append future built-ins (`'Explanatory'`, `'Learning'`, …) here.
 */
export type ClaudeOutputStyle = 'default' | 'none' | 'Concise';

export const CLAUDE_OUTPUT_STYLES: ClaudeOutputStyle[] = ['default', 'none', 'Concise'];

/** Anything unrecognised falls back to inheriting the host's output style. */
export function normalizeOutputStyle(value: unknown): ClaudeOutputStyle {
	return CLAUDE_OUTPUT_STYLES.includes(value as ClaudeOutputStyle)
		? (value as ClaudeOutputStyle)
		: 'default';
}

/** Dashboard run-state view filter: All | Active (running/creating) | Stopped (stopped/error). */
export type InstanceFilter = 'all' | 'active' | 'stopped';

export function isInstanceFilter(v: unknown): v is InstanceFilter {
	return v === 'all' || v === 'active' || v === 'stopped';
}

/** Colour-scheme choice; `'auto'` follows the browser's `prefers-color-scheme`. */
export type Theme = 'light' | 'dark' | 'auto';

export function isTheme(v: unknown): v is Theme {
	return v === 'light' || v === 'dark' || v === 'auto';
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
	auth: AuthProvider[];
	/** Global default the picker's mode toggle starts on; per-instance override wins. */
	defaultMode: InstanceMode;
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
