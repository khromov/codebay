import { triggerReconcile } from './instances.server.ts';
import type { Agent } from '../agents.ts';

/** UI-only state: it drives a tab pulse and is never persisted. */
export type AttentionState = 'done' | 'waiting';

// Pin to globalThis so dev-mode hot reload doesn't drop pending signals.
const globalForAttention = globalThis as unknown as {
	__codebayAgentAttention?: Map<string, Partial<Record<Agent, AttentionState>>>;
};
const attention = (globalForAttention.__codebayAgentAttention ??= new Map());

export function getAttention(id: string): AttentionState | null {
	const states = Object.values(attention.get(id) ?? {});
	return states.includes('waiting') ? 'waiting' : states.includes('done') ? 'done' : null;
}

export function setAttention(id: string, state: AttentionState, agent: Agent = 'claude'): void {
	const states = attention.get(id) ?? {};
	if (states[agent] === state) {
		console.log(`[attention] setAttention id=${id} state=${state} — no change, skipping reconcile`);
		return;
	}
	states[agent] = state;
	attention.set(id, states);
	console.log(`[attention] setAttention id=${id} state=${state} → reconcile`);
	triggerReconcile();
}

export function clearAttention(id: string, agent?: Agent): void {
	const states = attention.get(id);
	if (!states || (agent && !states[agent])) {
		console.log(`[attention] clearAttention id=${id} — nothing set, skipping reconcile`);
		return;
	}
	if (agent) delete states[agent];
	if (!agent || Object.keys(states).length === 0) attention.delete(id);
	console.log(`[attention] clearAttention id=${id} → reconcile`);
	triggerReconcile();
}
