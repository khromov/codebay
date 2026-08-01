import { checkPresence, execInContainer, mergeJsonFileScript } from '../lib/exec.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/**
 * Pre-accepts the three prompts `claude` shows on first launch, so a throwaway instance
 * opens straight into a session: the folder-trust dialog and the MCP-server approval
 * (both per-project, keyed by the path `claude` runs in), and the one-time Bypass
 * Permissions acknowledgement (`--dangerously-skip-permissions` still trips it without this).
 * Key names verified against the shipped `claude` binary.
 */
export function claudeTrustConfig(workspacePath: string | null): Record<string, unknown> {
	const cfg: Record<string, unknown> = {
		// Idempotent with the credentials injection; keeps this self-sufficient when auth is skipped.
		hasCompletedOnboarding: true,
		bypassPermissionsModeAccepted: true
	};
	if (workspacePath) {
		cfg.projects = {
			[workspacePath]: {
				hasTrustDialogAccepted: true,
				hasCompletedProjectOnboarding: true,
				enableAllProjectMcpServers: true
			}
		};
	}
	return cfg;
}

/** Same resolution the credentials injection uses, so both target the one `.claude.json`. */
const CLAUDE_JSON_PATH_SETUP =
	'h=$(eval echo ~$(id -un)); f="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"; f="${f:-$h/.claude.json}"; ';

/** Safe here only because instances are throwaway, single-tenant sandboxes. */
export const claudeTrust: Injection = {
	id: 'claude-trust',
	label: 'Claude trust & MCP auto-accept',

	async apply(target, log) {
		log('Pre-accepting Claude trust, MCP, and bypass-permissions prompts…\n');
		const config = claudeTrustConfig(target.instance.remote_workspace_folder);
		const res = await execInContainer(target, {
			script: mergeJsonFileScript(CLAUDE_JSON_PATH_SETUP),
			stdin: JSON.stringify(config)
		});
		log(
			res.ok
				? '✓ Claude startup prompts pre-accepted\n'
				: `⚠ Claude trust injection failed: ${res.error}\n`
		);
	},

	async check(target: ContainerTarget) {
		return checkPresence(
			target,
			CLAUDE_JSON_PATH_SETUP +
				'[ -s "$f" ] && grep -q bypassPermissionsModeAccepted "$f" && echo 1 || echo 0'
		);
	}
};
