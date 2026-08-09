import type { InstanceMode, InstanceRow } from './db.server.ts';
import type { ExecTarget } from './exec.server.ts';
import { getOption } from './db.server.ts';
import { gitSafeDirectory } from '../container-injections/git-safe-directory.ts';
import { tmux } from '../container-injections/tmux.ts';
import { ttyd } from '../container-injections/ttyd.ts';
import { gitIdentity } from '../container-injections/git-identity.ts';
import { claudeCodeCredentials } from '../container-injections/claude-code-credentials.ts';
import { claudeCodeCustom } from '../container-injections/claude-code-custom.ts';
import { claudeCodeIdeExtension } from '../container-injections/claude-code-ide-extension.ts';
import { claudeCodeUpdate } from '../container-injections/claude-code-update.ts';
import { claudeCodeModels } from '../container-injections/claude-code-models.ts';
import { githubCredentials } from '../container-injections/github-credentials.ts';
import { attentionHooks } from '../container-injections/attention-hooks.ts';
import { claudeStatusline } from '../container-injections/claude-statusline.ts';
import { claudeModel } from '../container-injections/claude-model.ts';
import { claudeSkipPermissions } from '../container-injections/claude-skip-permissions.ts';
import { claudeTrust } from '../container-injections/claude-trust.ts';
import { claudeAliases } from '../container-injections/claude-aliases.ts';
import { claudeNoCoauthor } from '../container-injections/claude-no-coauthor.ts';
import { hostEnvVars } from '../container-injections/host-env-vars.ts';

/** Extends `ExecTarget` so exec-user semantics have a single source of truth. */
export interface ContainerTarget extends ExecTarget {
	instance: InstanceRow;
}

/**
 * Bundles host-side discovery, container `apply()`, and a live `check()` in one module,
 * so what gets injected and what gets health-probed can never drift apart.
 */
export interface Injection {
	/** Doubles as the health-row key. */
	id: string;
	label: string;
	/** Restrict to specific instance modes; absent means it applies to every mode. */
	modes?: InstanceMode[];
	/** Omit for injections with no host dependency — presence is what draws the setup-UI chip. */
	auth?: {
		/** Short instruction shown when unavailable, e.g. "run `gh auth login`". */
		hint: string;
		status(): Promise<{ available: boolean; source: string | null }>;
	};
	apply(target: ContainerTarget, log: (msg: string) => void): Promise<void>;
	/** Omit to keep the injection out of the health list. */
	check?(target: ContainerTarget): Promise<boolean>;
}

/** Split around the Claude slot, which `resolveInjections()` fills at call time. */
const BASE_INJECTIONS_HEAD: Injection[] = [
	// Must stay first — every later git-touching injection depends on safe.directory.
	gitSafeDirectory,
	// The package install is the slowest injection, so start it before a folderOpen can find tmux missing.
	tmux,
	// Terminal-mode only (filtered by resolveInjections); a download, so run it early like tmux.
	ttyd,
	gitIdentity
];

const BASE_INJECTIONS_TAIL: Injection[] = [
	// Refresh the binary to latest before the other claude-config steps run against it.
	claudeCodeUpdate,
	// Self-skips unless manual override is on and LiteLLM off, so it's safe in the always-run tail.
	claudeCodeModels,
	claudeCodeIdeExtension,
	githubCredentials,
	attentionHooks,
	claudeStatusline,
	claudeModel,
	claudeSkipPermissions,
	claudeTrust,
	claudeAliases,
	claudeNoCoauthor,
	hostEnvVars
];

/**
 * Resolved per call so toggling the custom-endpoint setting takes effect without a restart.
 * `mode` drops injections that don't apply to it (e.g. ttyd off IDE instances, the IDE
 * extension off terminal ones); omit it in mode-agnostic contexts to keep every injection.
 */
export function resolveInjections(mode?: InstanceMode): Injection[] {
	const claudeInjection =
		getOption('custom_endpoint_enabled') === '1' ? claudeCodeCustom : claudeCodeCredentials;
	const all = [...BASE_INJECTIONS_HEAD, claudeInjection, ...BASE_INJECTIONS_TAIL];
	return mode ? all.filter((i) => !i.modes || i.modes.includes(mode)) : all;
}

/** @deprecated Use `resolveInjections()`; this ignores settings/mode and is kept for the tests. */
export const injections: Injection[] = [
	...BASE_INJECTIONS_HEAD,
	claudeCodeCredentials,
	...BASE_INJECTIONS_TAIL
];
