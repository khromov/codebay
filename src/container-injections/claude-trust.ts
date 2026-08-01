import { deepMerge, editJsonFile, readJsonFile } from '../lib/container-files.server.ts';
import { CLAUDE_JSON_FILE } from '../lib/claude-settings.server.ts';
import type { Injection } from '../lib/injections.server.ts';

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

/** Safe here only because instances are throwaway, single-tenant sandboxes. */
export const claudeTrust: Injection = {
	id: 'claude-trust',
	label: 'Claude trust & MCP auto-accept',

	async apply(target, log) {
		log('Pre-accepting Claude trust, MCP, and bypass-permissions prompts…\n');
		// deepMerge recurses into `projects`, so the per-project keys layer onto any existing entries.
		const res = await editJsonFile(target, CLAUDE_JSON_FILE, (cur) =>
			deepMerge(cur, claudeTrustConfig(target.instance.remote_workspace_folder))
		);
		log(
			res.ok
				? '✓ Claude startup prompts pre-accepted\n'
				: `⚠ Claude trust injection failed: ${res.error}\n`
		);
	},

	async check(target) {
		const cfg = await readJsonFile(target, CLAUDE_JSON_FILE);
		return cfg?.bypassPermissionsModeAccepted === true;
	}
};
