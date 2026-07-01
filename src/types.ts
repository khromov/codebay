/** One published container→host port mapping, reachable at http://localhost:<host_port>. */
export interface PortForward {
	container_port: number;
	host_port: number;
	/** Live: the container actually publishes this port per Docker. Set only when serializing for the client. */
	open?: boolean;
}

/** Client-safe shape of an instance, mirrors the server's InstanceRow. */
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
	/**
	 * Image this instance was created with: `'local'` when the source folder shipped its own
	 * devcontainer.json, otherwise the default image reference that was injected. Null until provisioned.
	 */
	image_source: string | null;
	/** Branch checked out in the container, polled per reconcile; null if unknown. */
	git_branch: string | null;
	/** Live signal raised by the in-container Claude hook: task done, waiting on input, or none. */
	attention: 'done' | 'waiting' | null;
	/** App ports published from the container, each on its own unique host port. */
	forwarded_ports: PortForward[];
}

/**
 * Live health snapshot for one instance, produced by a background monitor that
 * re-runs every check every few seconds while the container is alive. Never
 * persisted — always reflects the most recent probe.
 */
export interface InstanceHealth {
	/** Container is up per `docker inspect`. */
	containerRunning: boolean;
	/** code-server answered an HTTP probe on its host port. */
	codeServerAccessible: boolean;
	/**
	 * One presence row per injection that defines a `check()` (Claude Code creds,
	 * GitHub CLI, attention hooks). Driven by the injection registry, so it grows
	 * automatically as injections are added. Empty while the container is down.
	 */
	injections: { id: string; label: string; ok: boolean }[];
	/** Container ports currently published to the host per Docker (the `docker ps` view). */
	openPorts: number[];
	/** Epoch ms when these checks last ran. */
	checkedAt: number;
}

/** One authorization the manager can inject into instances (e.g. Claude Code). */
export interface AuthProvider {
	id: string;
	label: string;
	available: boolean;
	/** Where the credential was found (keystore entry or file path), null if absent. */
	source: string | null;
	/** Short instruction shown when absent, e.g. "run `gh auth login`". */
	hint?: string;
}

export interface Preflight {
	docker: boolean;
	cli: boolean;
	auth: AuthProvider[];
}

/**
 * Same-origin path to an instance's code-server, proxied through the manager
 * and gated by the app's Basic Auth. Opens the project folder when known.
 */
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

/** A previously-used source folder, shown for quick re-creation. */
export interface FolderHistoryEntry {
	source_path: string;
	name: string;
	last_used_at: number;
}
