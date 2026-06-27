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
  /** Branch checked out in the container, polled per reconcile; null if unknown. */
  git_branch: string | null;
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
