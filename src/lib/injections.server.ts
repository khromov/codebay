import type { InstanceRow } from './db.server.ts';
import { gitSafeDirectory } from '../container-injections/git-safe-directory.ts';
import { gitIdentity } from '../container-injections/git-identity.ts';
import { claudeCodeCredentials } from '../container-injections/claude-code-credentials.ts';
import { githubCredentials } from '../container-injections/github-credentials.ts';
import { attentionHooks } from '../container-injections/attention-hooks.ts';
import { claudeSkipPermissions } from '../container-injections/claude-skip-permissions.ts';

/** A running container an injection acts on, plus the instance row behind it. */
export interface ContainerTarget {
	containerId: string;
	/** The container's exec user; falls back to `root` when unknown. */
	remoteUser?: string | null;
	/** The full instance row — gives an injection its id and `bridge_token`. */
	instance: InstanceRow;
}

/**
 * One self-contained thing the manager installs into a freshly-provisioned
 * container (credentials, hooks, git config). Every injection owns its host-side
 * discovery, its container `apply()`, and an optional live `check()` that the
 * health monitor runs — so what gets injected and what gets health-probed never
 * drift apart. Add a new injection by dropping a module in `src/container-injections/`
 * and listing it in the registry below; remove one by deleting it from that list.
 */
export interface Injection {
	/** Stable id, also used as the health-row key (e.g. `claude-code-credentials`). */
	id: string;
	/** Human label, reused as the health-row label and the auth-chip label. */
	label: string;
	/**
	 * Host-side authorization surfaced on the preflight/setup UI. Omit for
	 * injections with no host dependency (e.g. git safe.directory, attention hooks).
	 */
	auth?: {
		/** Short instruction shown when unavailable, e.g. "run `gh auth login`". */
		hint: string;
		/** Whether the host credential is available, and where it was found. */
		status(): Promise<{ available: boolean; source: string | null }>;
	};
	/** Inject into the running container; reports progress through `log`. */
	apply(target: ContainerTarget, log: (msg: string) => void): Promise<void>;
	/**
	 * Live-probe whether this injection is present/healthy in the container.
	 * Omit to keep the injection out of the health list.
	 */
	check?(target: ContainerTarget): Promise<boolean>;
}

/**
 * Every injection applied to a freshly-provisioned container, in apply order
 * (git safe.directory first so subsequent git-touching steps work). The boot
 * driver in `instances.server.ts` runs each `apply()`, the health monitor runs
 * each `check()`, and `routes.ts` builds the auth chips from each `auth`. Add or
 * remove an injection by editing this list.
 */
export const injections: Injection[] = [
	gitSafeDirectory,
	gitIdentity,
	claudeCodeCredentials,
	githubCredentials,
	attentionHooks,
	claudeSkipPermissions
];
