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
	/** Polled per reconcile rather than persisted; null if unknown. */
	git_branch: string | null;
	attention: 'done' | 'waiting' | null;
	forwarded_ports: PortForward[];
}

/** Dashboard run-state view filter: All | Active (running/creating) | Stopped (stopped/error). */
export type InstanceFilter = 'all' | 'active' | 'stopped';

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
