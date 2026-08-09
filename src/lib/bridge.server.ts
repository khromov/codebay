import { triggerReconcile } from './instances.server.ts';

/** UI-only state: it drives a tab pulse and is never persisted. */
export type AttentionState = 'done' | 'waiting';

// Pin to globalThis so dev-mode hot reload doesn't drop pending signals.
const globalForAttention = globalThis as unknown as {
	__codebayAttention?: Map<string, AttentionState>;
	__codebayTask?: Map<string, string>;
};
const attention: Map<string, AttentionState> = (globalForAttention.__codebayAttention ??=
	new Map());

// The most recent prompt Claude was handed inside each container — a UI-only "current task"
// label, never persisted, keyed by instance id like attention above.
const tasks: Map<string, string> = (globalForAttention.__codebayTask ??= new Map());

/** Cap on the stored task so one runaway prompt can't bloat the in-memory map. */
const MAX_TASK_LEN = 500;

export function getTask(id: string): string | null {
	return tasks.get(id) ?? null;
}

export function setTask(id: string, task: string): void {
	// Collapse whitespace so a multi-line prompt renders as one tidy card subtitle.
	const cleaned = task.replace(/\s+/g, ' ').trim().slice(0, MAX_TASK_LEN);
	if (!cleaned || tasks.get(id) === cleaned) return;
	tasks.set(id, cleaned);
	triggerReconcile();
}

export function clearTask(id: string): void {
	if (tasks.delete(id)) triggerReconcile();
}

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
