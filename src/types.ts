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
  /** Server-rendered SVG avatar markup, unique per instance. */
  avatar: string;
}

export interface Preflight {
  docker: boolean;
  cli: boolean;
  claudeAuth: boolean;
}

/** Local URL for an instance's code-server, opening the project folder when known. */
export function ideUrl(instance: Instance): string {
  const base = `http://localhost:${instance.host_port}/`;
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
