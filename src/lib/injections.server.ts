import type { InstanceRow } from './db.server.ts';
import type { ExecTarget } from './exec.server.ts';
import { getOption } from './db.server.ts';
import { gitSafeDirectory } from '../container-injections/git-safe-directory.ts';
import { tmux } from '../container-injections/tmux.ts';
import { gitIdentity } from '../container-injections/git-identity.ts';
import { claudeCodeCredentials } from '../container-injections/claude-code-credentials.ts';
import { claudeCodeCustom } from '../container-injections/claude-code-custom.ts';
import { claudeCodeModels } from '../container-injections/claude-code-models.ts';
import { githubCredentials } from '../container-injections/github-credentials.ts';
import { attentionHooks } from '../container-injections/attention-hooks.ts';
import { claudeStatusline } from '../container-injections/claude-statusline.ts';
import { claudeModel } from '../container-injections/claude-model.ts';
import { claudeSkipPermissions } from '../container-injections/claude-skip-permissions.ts';
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
	gitIdentity
];

const BASE_INJECTIONS_TAIL: Injection[] = [
	// Self-skips unless manual override is on and LiteLLM off, so it's safe in the always-run tail.
	claudeCodeModels,
	githubCredentials,
	attentionHooks,
	claudeStatusline,
	claudeModel,
	claudeSkipPermissions,
	claudeAliases,
	claudeNoCoauthor,
	hostEnvVars
];

/** Resolved per call so toggling the custom-endpoint setting takes effect without a restart. */
export function resolveInjections(): Injection[] {
	const claudeInjection =
		getOption('custom_endpoint_enabled') === '1' ? claudeCodeCustom : claudeCodeCredentials;
	return [...BASE_INJECTIONS_HEAD, claudeInjection, ...BASE_INJECTIONS_TAIL];
}

/** @deprecated Use `resolveInjections()`; this ignores settings and is kept for the tests. */
export const injections: Injection[] = [
	...BASE_INJECTIONS_HEAD,
	claudeCodeCredentials,
	...BASE_INJECTIONS_TAIL
];
