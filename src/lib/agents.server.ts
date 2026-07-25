import type { Agent } from '../types.ts';
import { getOption, setOption } from './db.server.ts';

export const AGENTS: readonly Agent[] = ['claude', 'codex'];

export function isAgent(value: unknown): value is Agent {
	return value === 'claude' || value === 'codex';
}

/** Whether an agent may be selected for a new instance. */
export function agentEnabled(agent: Agent): boolean {
	const stored = getOption(`agent_${agent}_enabled`);
	if (stored === null) return agent === 'claude';
	return stored === '1';
}

/** Enabled agents in stable UI order. */
export function enabledAgents(): Agent[] {
	return AGENTS.filter(agentEnabled);
}

/** Default for callers that predate explicit agent selection. */
export function defaultAgent(): Agent {
	const enabled = enabledAgents();
	if (enabled.includes('claude')) return 'claude';
	return enabled[0] ?? 'claude';
}

/**
 * Change which agents can be selected for new instances. Existing instances
 * retain their persisted agent and remain rebuildable.
 */
export function setAgentEnabled(agent: Agent, enabled: boolean): void {
	if (!enabled && agentEnabled(agent) && enabledAgents().length === 1) {
		throw new Error('At least one coding agent must remain enabled');
	}
	setOption(`agent_${agent}_enabled`, enabled ? '1' : '0');
}
