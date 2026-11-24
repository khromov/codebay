import { emptyRunState, type RunStreamState, type RunTimelineEntry } from './agent-run-stream.ts';

const ACTIVITY_MAX = 120;
const TIMELINE_MAX = 400;

function truncate(text: string, max = ACTIVITY_MAX): string {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

/** Antigravity's tool argument fields (PascalCase) plus lowercase fallbacks for MCP/custom tools. */
const TOOL_SUMMARY_FIELDS = [
	'CommandLine',
	'TargetFile',
	'AbsolutePath',
	'DirectoryPath',
	'SearchPath',
	'SearchDirectory',
	'Query',
	'Pattern',
	'Url',
	'Prompt',
	'Role',
	'command',
	'file_path',
	'path',
	'pattern',
	'description',
	'query',
	'url',
	'prompt'
];

function summarizeParameters(input: unknown): string {
	if (typeof input !== 'object' || input === null) return '';
	const obj = input as Record<string, unknown>;
	for (const field of TOOL_SUMMARY_FIELDS) {
		const value = obj[field];
		if (typeof value === 'string' && value.trim()) return value;
	}
	const first = Object.values(obj).find((v) => typeof v === 'string' && v.trim());
	return typeof first === 'string' ? first : '';
}

interface SubagentSpec {
	type_name?: string;
	role?: string;
}

interface StepUpdate {
	conversation_id?: string;
	step_index?: number;
	state?: string;
	step_type?: string;
	tool_name?: string;
	text_delta?: string;
	tool_info?: {
		name?: string;
		parameters?: unknown;
		output?: string;
		error?: { type?: string; message?: string };
	};
	subagent_info?: {
		subagents?: SubagentSpec[];
	};
}

interface AntigravityResult {
	conversation_id?: string;
	status?: string;
	response?: string;
	error?: string;
	duration_seconds?: number;
	num_turns?: number;
	structured_output?: unknown;
}

interface AntigravityEvent {
	event?: string;
	conversation_id?: string;
	init?: {
		model?: string;
	};
	step_update?: StepUpdate;
	result?: AntigravityResult;
}

function summarizeStepTool(step: StepUpdate): { name: string; arg: string } {
	const name = step.tool_info?.name || step.tool_name || 'tool';
	const subagents = step.subagent_info?.subagents;
	if (Array.isArray(subagents) && subagents.length > 0) {
		const roles = subagents
			.map((s) => s.role || s.type_name)
			.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
		if (roles.length) return { name, arg: roles.join(', ') };
	}
	return { name, arg: summarizeParameters(step.tool_info?.parameters) };
}

function applyAntigravityEvent(state: RunStreamState, event: AntigravityEvent): void {
	if (typeof event.conversation_id === 'string' && event.conversation_id && !state.sessionId) {
		state.sessionId = event.conversation_id;
	}

	if (event.event === 'init') {
		if (typeof event.init?.model === 'string' && event.init.model.trim()) {
			state.model = event.init.model.trim();
		}
		return;
	}

	if (event.event === 'step_update' && event.step_update) {
		const step = event.step_update;
		if (typeof step.conversation_id === 'string' && step.conversation_id && !state.sessionId) {
			state.sessionId = step.conversation_id;
		}
		if (step.step_type === 'tool') {
			const { name, arg } = summarizeStepTool(step);
			state.lastActivity = arg ? `${name}(${truncate(arg)})` : name;
			return;
		}
		if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
			const idx = typeof step.step_index === 'number' ? step.step_index : -1;
			// Text streams as incremental deltas across ACTIVE/DONE updates for the same step_index.
			const assembled =
				state.activeStepIndex === idx
					? (state.activeStepText ?? '') + step.text_delta
					: step.text_delta;
			state.activeStepIndex = idx;
			state.activeStepText = assembled;
			if (assembled.trim()) {
				state.lastAssistantText = assembled.trim();
				state.lastActivity = truncate(assembled);
			}
		}
		return;
	}

	if (event.event === 'result' && event.result) {
		const r = event.result;
		state.resultSeen = true;
		if (typeof r.conversation_id === 'string' && r.conversation_id && !state.sessionId) {
			state.sessionId = r.conversation_id;
		}
		state.isError = r.status !== 'SUCCESS';
		if (typeof r.response === 'string' && r.response.length > 0) {
			state.result = r.response.trimEnd();
		}
		if (typeof r.error === 'string' && r.error.trim()) {
			state.errorMessage = r.error.trim();
		}
		if (r.structured_output !== undefined && r.structured_output !== null) {
			state.structuredOutput = JSON.stringify(r.structured_output);
		}
		if (typeof r.num_turns === 'number') state.numTurns = r.num_turns;
		if (typeof r.duration_seconds === 'number') {
			state.durationMs = Math.round(r.duration_seconds * 1000);
		}
	}
}

/**
 * Antigravity twin of `readRunChunk`: folds incremental NDJSON `agy -p --output-format stream-json`
 * output into `RunStreamState`, carrying any incomplete trailing line into the next chunk.
 */
export function readAntigravityRunChunk(
	state: RunStreamState,
	carry: string,
	chunk: string
): { state: RunStreamState; carry: string } {
	const lines = (carry + chunk).split('\n');
	const tail = lines.pop() ?? '';
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			applyAntigravityEvent(state, JSON.parse(trimmed) as AntigravityEvent);
		} catch {
			// Stray shell/diagnostic line; ignore it.
		}
	}
	return { state, carry: tail };
}

export function readAntigravityRunFile(text: string): RunStreamState {
	return readAntigravityRunChunk(emptyRunState(), '', text).state;
}

/**
 * Flattens an Antigravity `stream-json` mirror into Agent log rows, coalescing incremental
 * `step_update` deltas and `ACTIVE`→`DONE` transitions that share a `step_index`.
 */
export function parseAntigravityTimeline(text: string): RunTimelineEntry[] {
	const out: RunTimelineEntry[] = [];
	const byStep = new Map<number, { index: number; rawText?: string }>();

	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let event: AntigravityEvent;
		try {
			event = JSON.parse(trimmed) as AntigravityEvent;
		} catch {
			continue;
		}

		if (event.event === 'step_update' && event.step_update) {
			const step = event.step_update;
			const stepIdx = typeof step.step_index === 'number' ? step.step_index : null;

			if (step.step_type === 'tool') {
				const { name, arg } = summarizeStepTool(step);
				const entry: RunTimelineEntry = {
					kind: 'tool',
					name,
					text: truncate(arg, TIMELINE_MAX),
					...(step.tool_info?.error ? { isError: true } : {})
				};
				const existing = stepIdx !== null ? byStep.get(stepIdx) : undefined;
				if (existing) {
					out[existing.index] = entry;
				} else {
					const index = out.push(entry) - 1;
					if (stepIdx !== null) byStep.set(stepIdx, { index });
				}
				continue;
			}

			if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
				const existing = stepIdx !== null ? byStep.get(stepIdx) : undefined;
				const rawText = (existing?.rawText ?? '') + step.text_delta;
				if (!rawText.trim()) continue;
				const entry: RunTimelineEntry = { kind: 'text', text: truncate(rawText, TIMELINE_MAX) };
				if (existing) {
					existing.rawText = rawText;
					out[existing.index] = entry;
				} else {
					const index = out.push(entry) - 1;
					if (stepIdx !== null) byStep.set(stepIdx, { index, rawText });
				}
			}
			continue;
		}

		if (event.event === 'result' && event.result) {
			const r = event.result;
			const isError = r.status !== 'SUCCESS';
			const textBody = isError
				? r.error?.trim() || r.response?.trim() || r.status || 'error'
				: r.response?.trim() || r.status || 'finished';
			const entry: RunTimelineEntry = {
				kind: 'result',
				text: truncate(textBody, TIMELINE_MAX),
				isError
			};
			const prev = out.at(-1);
			if (prev?.kind === 'text' && prev.text === entry.text) out.pop();
			out.push(entry);
		}
	}

	return out;
}
