import { triggerReconcile } from './instances.server.ts';

/**
 * Ephemeral "attention" signal each container can raise via the bridge: Claude
 * finished a task (`done`) or is waiting on the user (`waiting`). It's UI-only
 * state — kept in memory, never persisted — surfaced on the instance list and
 * cleared when the user looks at the tab or Claude resumes work.
 */
export type AttentionState = 'done' | 'waiting';

// Pin to globalThis so dev-mode hot reload doesn't drop pending signals.
const globalForAttention = globalThis as unknown as {
	__dcmAttention?: Map<string, AttentionState>;
};
const attention: Map<string, AttentionState> = (globalForAttention.__dcmAttention ??= new Map());

export function getAttention(id: string): AttentionState | null {
	return attention.get(id) ?? null;
}

export function setAttention(id: string, state: AttentionState): void {
	if (attention.get(id) === state) {
		console.log(`[attention] setAttention id=${id} state=${state} — no change, skipping reconcile`);
		return;
	}
	attention.set(id, state);
	console.log(`[attention] setAttention id=${id} state=${state} → reconcile`);
	triggerReconcile();
}

export function clearAttention(id: string): void {
	if (!attention.delete(id)) {
		console.log(`[attention] clearAttention id=${id} — nothing set, skipping reconcile`);
		return;
	}
	console.log(`[attention] clearAttention id=${id} → reconcile`);
	triggerReconcile();
}
