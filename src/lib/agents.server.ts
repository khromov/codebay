import { getOption } from './db.server.ts';
import {
	normalizeAgentSelection,
	CODEX_PERMISSION_MODES,
	CODEX_EFFORT_LEVELS,
	CODEX_VERBOSITIES,
	type AgentSettings
} from '../agents.ts';

export const getAgentSelection = () => normalizeAgentSelection(getOption('agent_selection'));

export function manualCredentialEnabled(service: 'claude' | 'github'): boolean {
	return (getOption(`manual_${service}_enabled`) ?? getOption('manual_tokens_enabled')) === '1';
}

export function getAgentSettings(): AgentSettings {
	const permission = getOption('codex_permission_mode');
	const effort = getOption('codex_effort');
	const verbosity = getOption('codex_verbosity');
	return {
		selection: getAgentSelection(),
		codexConfigDir: getOption('codex_config_dir') ?? '',
		codexPermissionMode: CODEX_PERMISSION_MODES.includes(
			permission as AgentSettings['codexPermissionMode']
		)
			? (permission as AgentSettings['codexPermissionMode'])
			: 'full-access',
		codexModel: getOption('codex_model') ?? '',
		codexEffort: CODEX_EFFORT_LEVELS.includes(effort as AgentSettings['codexEffort'])
			? (effort as AgentSettings['codexEffort'])
			: 'default',
		codexVerbosity: CODEX_VERBOSITIES.includes(verbosity as AgentSettings['codexVerbosity'])
			? (verbosity as AgentSettings['codexVerbosity'])
			: 'default',
		codexEndpointEnabled: getOption('codex_endpoint_enabled') === '1',
		codexBaseUrl: getOption('codex_base_url') ?? '',
		codexKeySet: !!getOption('codex_api_key'),
		githubManualEnabled: manualCredentialEnabled('github'),
		claudeManualEnabled: manualCredentialEnabled('claude')
	};
}
