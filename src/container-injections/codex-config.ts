import { getAgentSettings } from '../lib/agents.server.ts';
import { readHostCodexConfig } from '../lib/host-codex.server.ts';
import { codexConfigFile, mergeCodexConfig } from '../lib/codex-settings.server.ts';
import { appendLinesIfAbsent, SHELL_RC_FILES } from '../lib/container-files.server.ts';
import { checkPresence } from '../lib/exec.server.ts';
import { codexPermissionFlags, type AgentSettings } from '../agents.ts';
import type { Injection } from '../lib/injections.server.ts';

export function codexConfigPatch(
	settings: AgentSettings,
	host: Record<string, unknown>,
	workspace: string
): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	// Host-local paths, cached trust, and MCP credentials are not portable container configuration.
	for (const key of [
		'model',
		'model_reasoning_effort',
		'model_reasoning_summary',
		'model_verbosity',
		'personality',
		'tui'
	]) {
		if (host[key] !== undefined) patch[key] = host[key];
	}
	Object.assign(patch, {
		cli_auth_credentials_store: 'file',
		check_for_update_on_startup: false,
		approval_policy: settings.codexPermissionMode === 'full-access' ? 'never' : 'on-request',
		sandbox_mode:
			settings.codexPermissionMode === 'full-access'
				? 'danger-full-access'
				: settings.codexPermissionMode === 'workspace'
					? 'workspace-write'
					: 'read-only',
		projects: { [workspace]: { trust_level: 'trusted' } },
		notice: { hide_full_access_warning: settings.codexPermissionMode === 'full-access' }
	});
	if (settings.codexModel.trim()) patch.model = settings.codexModel.trim();
	if (settings.codexEffort !== 'default') patch.model_reasoning_effort = settings.codexEffort;
	if (settings.codexVerbosity !== 'default') patch.model_verbosity = settings.codexVerbosity;
	if (settings.codexEndpointEnabled && settings.codexBaseUrl.trim()) {
		patch.model_provider = 'codebay';
		patch.model_providers = {
			codebay: {
				name: 'Codebay custom endpoint',
				base_url: settings.codexBaseUrl.trim(),
				wire_api: 'responses',
				requires_openai_auth: true
			}
		};
	}
	return patch;
}

export const codexConfig: Injection = {
	id: 'codex-config',
	label: 'Codex settings & shell command',
	async apply(target, log) {
		const settings = getAgentSettings();
		const patch = codexConfigPatch(
			settings,
			await readHostCodexConfig(),
			target.instance.remote_workspace_folder ?? target.instance.workspace_path
		);
		const result = await mergeCodexConfig(target, patch);
		if (!result.ok) {
			log(`⚠ Codex settings injection failed: ${result.error}\n`);
			return;
		}
		const alias = await appendLinesIfAbsent(target, SHELL_RC_FILES, [
			`alias codex='codex ${codexPermissionFlags(settings.codexPermissionMode)}'`
		]);
		log(
			alias.ok
				? '✓ Codex settings and command configured\n'
				: `⚠ Codex command setup failed: ${alias.error}\n`
		);
	},
	check: (target) =>
		checkPresence(
			target,
			`h=$(eval echo ~$(id -un)); test -s "${codexConfigFile('config.toml').dir}/config.toml" && echo 1 || echo 0`
		)
};
