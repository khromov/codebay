import type { RunStreamState, RunTimelineEntry } from './agent-run-stream.ts';

interface CodexItem {
	id?: string;
	type?: string;
	text?: string;
	message?: string;
	command?: string;
	tool?: string;
	server?: string;
	status?: string;
	aggregated_output?: string;
	changes?: { path: string; kind: string }[];
	error?: { message?: string };
}
interface CodexEvent {
	type?: string;
	thread_id?: string;
	model?: string;
	item?: CodexItem;
	error?: { message?: string };
	message?: string;
	usage?: Record<string, number>;
}

function itemText(item: CodexItem): string {
	if (typeof item.text === 'string') return item.text;
	if (typeof item.message === 'string') return item.message;
	if (typeof item.command === 'string') return item.command;
	if (Array.isArray(item.changes))
		return item.changes
			.filter(Boolean)
			.map((change) => `${change.kind} ${change.path}`)
			.join(', ');
	return [item.server, item.tool].filter(Boolean).join(': ') || item.type || 'Working';
}

function apply(state: RunStreamState, event: CodexEvent) {
	if (event.thread_id) state.sessionId = event.thread_id;
	if (event.model) state.model = event.model;
	if (event.item) {
		state.lastActivity = itemText(event.item).replace(/\s+/g, ' ').slice(0, 120);
		if (event.item.type === 'agent_message' && event.type === 'item.completed')
			state.result = event.item.text ?? state.result;
	}
	if (event.type === 'turn.completed') {
		state.resultSeen = true;
		state.isError = false;
		state.numTurns = (state.numTurns ?? 0) + 1;
		state.tokenUsage = event.usage ?? null;
	}
	if (event.type === 'turn.failed' || event.type === 'error') {
		state.isError = true;
		state.resultSeen = true;
		state.result = event.error?.message ?? event.message ?? 'Codex run failed';
		state.lastActivity = state.result;
	}
}

export function readCodexChunk(state: RunStreamState, carry: string, chunk: string) {
	const lines = (carry + chunk).split('\n');
	const remainder = lines.pop() ?? '';
	for (const line of lines) {
		try {
			const event = JSON.parse(line);
			if (event && typeof event === 'object') apply(state, event);
		} catch {
			/* A partial or diagnostic line is not an event. */
		}
	}
	return { state, carry: remainder };
}

export function parseCodexTimeline(raw: string): RunTimelineEntry[] {
	const entries: RunTimelineEntry[] = [];
	const itemPositions = new Map<string, number>();
	for (const line of raw.split('\n')) {
		let event: CodexEvent;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!event || typeof event !== 'object') continue;
		const item = event.item;
		if (item) {
			const entry: RunTimelineEntry = {
				kind:
					item.type === 'agent_message' || item.type === 'reasoning' || item.type === 'error'
						? 'text'
						: 'tool',
				name: item.type,
				text: itemText(item).slice(0, 400),
				isError: item.status === 'failed' || item.type === 'error'
			};
			const previous = item.id ? itemPositions.get(item.id) : undefined;
			if (previous !== undefined) entries[previous] = entry;
			else {
				if (item.id) itemPositions.set(item.id, entries.length);
				entries.push(entry);
			}
		}
		if (event.type === 'turn.failed' || event.type === 'error')
			entries.push({
				kind: 'result',
				text: event.error?.message ?? event.message ?? 'Codex run failed',
				isError: true
			});
	}
	return entries;
}
