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
import { claudeCodeInstall } from '../container-injections/claude-code-install.ts';
import { claudeCodeUpdate } from '../container-injections/claude-code-update.ts';
import { claudeCodeModels } from '../container-injections/claude-code-models.ts';
import { githubCredentials } from '../container-injections/github-credentials.ts';
import { attentionHooks } from '../container-injections/attention-hooks.ts';
import { claudeStatusline } from '../container-injections/claude-statusline.ts';
import { claudeModel } from '../container-injections/claude-model.ts';
import { claudeEffortLevel } from '../container-injections/claude-effort-level.ts';
import { claudePermissionMode } from '../container-injections/claude-permission-mode.ts';
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

/**
 * Injections within a stage apply in parallel, so no two of them may write the same container
 * resource; the stage boundaries serialize each shared resource in the same relative order the
 * old flat list ran it (gitconfig, ~/.claude/settings.json, rc files, ~/.claude.json, apt/dpkg).
 */
function buildStages(claudeInjection: Injection): Injection[][] {
	return [
		// Disjoint resources — and the slow network installs (apt tmux, npm/standalone claude,
		// Open VSX extension) start immediately instead of queueing behind one another.
		// claude-code-install (terminal-only) must precede claude-code-update: both are the sole
		// npm-global writer of their stage, and the update no-ops until a binary exists.
		[
			gitSafeDirectory,
			tmux,
			claudeCodeInstall,
			claudeInjection,
			claudeCodeIdeExtension,
			claudeEffortLevel
		],
		// git-identity needs stage 1's safe.directory; ttyd shares the apt/dpkg lock with tmux and
		// the /usr/local/bin symlink with claude-code-install, so it trails both.
		[gitIdentity, attentionHooks, claudeCodeModels, ttyd, claudeCodeUpdate],
		[githubCredentials, claudeStatusline, claudePermissionMode],
		[claudeModel, claudeAliases],
		// claude-trust edits ~/.claude.json, which the stage-1 Claude slot also writes.
		[claudeTrust, hostEnvVars],
		[claudeNoCoauthor]
	];
}

/**
 * Resolved per call so toggling the custom-endpoint setting takes effect without a restart.
 * `mode` drops injections that don't apply to it (e.g. ttyd off IDE instances, the IDE
 * extension off terminal ones); omit it in mode-agnostic contexts to keep every injection.
 */
export function resolveInjectionStages(mode?: InstanceMode): Injection[][] {
	const claudeInjection =
		getOption('custom_endpoint_enabled') === '1' ? claudeCodeCustom : claudeCodeCredentials;
	const stages = buildStages(claudeInjection)
		.map((stage) => (mode ? stage.filter((i) => !i.modes || i.modes.includes(mode)) : stage))
		.filter((stage) => stage.length > 0);
	// One injection per stage restores the fully serial boot for diagnosing injection interference.
	return getOption('advanced_serial_injections') === '1' ? stages.flat().map((i) => [i]) : stages;
}

/** Flat view of `resolveInjectionStages()` for order-insensitive consumers (health, auth chips). */
export function resolveInjections(mode?: InstanceMode): Injection[] {
	return resolveInjectionStages(mode).flat();
}

/** @deprecated Use `resolveInjections()`; this ignores settings/mode and is kept for the tests. */
export const injections: Injection[] = buildStages(claudeCodeCredentials).flat();
