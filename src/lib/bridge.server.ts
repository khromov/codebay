import { triggerReconcile } from './instances.server.ts';

/** UI-only state: it drives a tab pulse and is never persisted. */
export type AttentionState = 'done' | 'waiting';

// Pin to globalThis so dev-mode hot reload doesn't drop pending signals.
const globalForAttention = globalThis as unknown as {
	__codebayAttention?: Map<string, AttentionState>;
};
const attention: Map<string, AttentionState> = (globalForAttention.__codebayAttention ??=
	new Map());

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
