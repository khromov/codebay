import type { InstanceRow } from './db.server.ts';
import type { ExecTarget } from './exec.server.ts';
import { getOption } from './db.server.ts';
import { gitSafeDirectory } from '../container-injections/git-safe-directory.ts';
import { tmux } from '../container-injections/tmux.ts';
import { gitIdentity } from '../container-injections/git-identity.ts';
import { claudeCodeCredentials } from '../container-injections/claude-code-credentials.ts';
import { claudeCodeCustom } from '../container-injections/claude-code-custom.ts';
import { githubCredentials } from '../container-injections/github-credentials.ts';
import { attentionHooks } from '../container-injections/attention-hooks.ts';
import { claudeStatusline } from '../container-injections/claude-statusline.ts';
import { claudeSkipPermissions } from '../container-injections/claude-skip-permissions.ts';
import { claudeAliases } from '../container-injections/claude-aliases.ts';
import { hostEnvVars } from '../container-injections/host-env-vars.ts';

/**
 * A running container an injection acts on, plus the instance row behind it.
 * Extends `ExecTarget` so the `containerId`/`remoteUser` exec-user semantics have
 * a single source of truth (see `execInContainer`).
 */
export interface ContainerTarget extends ExecTarget {
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
 * Base injection list — the Claude credential injection slot is filled at
 * runtime by `resolveInjections()` so the choice between the default OAuth
 * injection and the custom-endpoint injection stays consistent across all
 * consumers (boot, health, routes). Direct callers should use
 * `resolveInjections()` rather than this array.
 */
const BASE_INJECTIONS_HEAD: Injection[] = [
	gitSafeDirectory,
	// tmux second: the package install is the slowest injection, so starting it
	// early shrinks the window in which a first folderOpen finds tmux missing.
	tmux,
	gitIdentity
];

const BASE_INJECTIONS_TAIL: Injection[] = [
	githubCredentials,
	attentionHooks,
	claudeStatusline,
	claudeSkipPermissions,
	claudeAliases,
	hostEnvVars
];

/**
 * Every injection applied to a freshly-provisioned container, in apply order
 * (git safe.directory first so subsequent git-touching steps work). The boot
 * driver in `instances.server.ts` runs each `apply()`, the health monitor runs
 * each `check()`, and `routes.ts` builds the auth chips from each `auth`. Add or
 * remove an injection by editing this list.
 *
 * The Claude credential injection is resolved at call time so toggling the
 * "custom endpoint" setting takes effect without restarting the server.
 */
export function resolveInjections(): Injection[] {
	const claudeInjection =
		getOption('custom_endpoint_enabled') === '1' ? claudeCodeCustom : claudeCodeCredentials;
	return [...BASE_INJECTIONS_HEAD, claudeInjection, ...BASE_INJECTIONS_TAIL];
}

/**
 * @deprecated Use `resolveInjections()` instead. This export is kept for
 * backwards compatibility with tests that inspect the static registry shape.
 * It always uses the default (OAuth) Claude injection regardless of settings.
 */
export const injections: Injection[] = [
	...BASE_INJECTIONS_HEAD,
	claudeCodeCredentials,
	...BASE_INJECTIONS_TAIL
];
