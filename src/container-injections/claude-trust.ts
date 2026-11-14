import { deepMerge, editJsonFile, readJsonFile } from '../lib/container-files.server.ts';
import {
	CLAUDE_JSON_FILE,
	mergeClaudeSettings,
	readClaudeSettings
} from '../lib/claude-settings.server.ts';
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

/** claude ≥2.1.220 keeps the bypass acknowledgement here; the `.claude.json` key stays for older versions. */
export const CLAUDE_TRUST_SETTINGS: Record<string, unknown> = {
	skipDangerousModePermissionPrompt: true
};

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
		if (!res.ok) {
			log(`⚠ Claude trust injection failed: ${res.error}\n`);
			return;
		}
		const settings = await mergeClaudeSettings(target, CLAUDE_TRUST_SETTINGS);
		log(
			settings.ok
				? '✓ Claude startup prompts pre-accepted\n'
				: `⚠ Claude trust injection failed: ${settings.error}\n`
		);
	},

	// Not keyed on `.claude.json`'s `bypassPermissionsModeAccepted`: claude ≥2.1.220 drops
	// that key (and `enableAllProjectMcpServers`) when it rewrites the file after startup.
	async check(target) {
		const settings = await readClaudeSettings(target);
		if (settings?.skipDangerousModePermissionPrompt !== true) return false;
		const workspace = target.instance.remote_workspace_folder;
		if (!workspace) return true;
		const cfg = await readJsonFile(target, CLAUDE_JSON_FILE);
		const projects = cfg?.projects as Record<string, Record<string, unknown>> | undefined;
		return projects?.[workspace]?.hasTrustDialogAccepted === true;
	}
};
