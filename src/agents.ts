export type Agent = 'claude' | 'codex';
export type AgentSelection = Agent | 'both';
export const AGENTS: Agent[] = ['claude', 'codex'];
export const AGENT_LABELS: Record<Agent, string> = { claude: 'Claude', codex: 'Codex' };
export const CODEX_PERMISSION_MODES = ['full-access', 'workspace', 'read-only'] as const;
export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number];
export const CODEX_EFFORT_LEVELS = [
	'default',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh'
] as const;
export const CODEX_VERBOSITIES = ['default', 'low', 'medium', 'high'] as const;

export function isAgent(value: unknown): value is Agent {
	return value === 'claude' || value === 'codex';
}

export function normalizeAgentSelection(value: unknown): AgentSelection {
	return value === 'codex' || value === 'both' ? value : 'claude';
}

export function agentsFor(selection: AgentSelection = 'claude'): Agent[] {
	return selection === 'both' ? [...AGENTS] : [selection];
}

export function preferredAgent(selection: AgentSelection, preference?: Agent): Agent {
	return preference && agentsFor(selection).includes(preference)
		? preference
		: agentsFor(selection)[0]!;
}

export function codexPermissionFlags(mode: CodexPermissionMode): string {
	return mode === 'full-access'
		? '--dangerously-bypass-approvals-and-sandbox'
		: `--sandbox ${mode === 'workspace' ? 'workspace-write' : 'read-only'} --ask-for-approval on-request`;
}

export interface AgentSettings {
	selection: AgentSelection;
	codexConfigDir: string;
	codexPermissionMode: CodexPermissionMode;
	codexModel: string;
	codexEffort: (typeof CODEX_EFFORT_LEVELS)[number];
	codexVerbosity: (typeof CODEX_VERBOSITIES)[number];
	codexEndpointEnabled: boolean;
	codexBaseUrl: string;
	codexKeySet: boolean;
	githubManualEnabled: boolean;
	claudeManualEnabled: boolean;
}
