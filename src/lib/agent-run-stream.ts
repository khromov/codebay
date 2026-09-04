/**
 * Parser for `claude -p --output-format stream-json --verbose` output. Pure and byte-oriented:
 * the poller tails raw bytes out of the container, so it hands us arbitrary chunks that usually
 * end mid-line. Kept free of Node/Bun APIs so it can be unit-tested on its own.
 */

/** Everything the run row needs, accumulated across chunks. */
export interface RunStreamState {
	sessionId: string | null;
	lastActivity: string | null;
	numTurns: number | null;
	costUsd: number | null;
	durationMs: number | null;
	result: string | null;
	/** Serialized `structured_output`, present only when the caller passed a `--json-schema`. */
	structuredOutput: string | null;
	isError: boolean;
	/** True once the terminal `result` event has been seen, whatever its subtype. */
	resultSeen: boolean;
}

export function emptyRunState(): RunStreamState {
	return {
		sessionId: null,
		lastActivity: null,
		numTurns: null,
		costUsd: null,
		durationMs: null,
		result: null,
		structuredOutput: null,
		isError: false,
		resultSeen: false
	};
}

/** Long enough to identify the step, short enough to sit on one line of a caller's poll output. */
const ACTIVITY_MAX = 120;

function truncate(text: string): string {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length > ACTIVITY_MAX ? oneLine.slice(0, ACTIVITY_MAX - 1) + '…' : oneLine;
}

/** The field that best identifies a call, per tool; anything unlisted falls back to the first string. */
const TOOL_SUMMARY_FIELDS = [
	'command',
	'file_path',
	'path',
	'pattern',
	'description',
	'query',
	'url',
	'prompt'
];

function summarizeToolInput(input: unknown): string {
	if (typeof input !== 'object' || input === null) return '';
	const obj = input as Record<string, unknown>;
	for (const field of TOOL_SUMMARY_FIELDS) {
		const value = obj[field];
		if (typeof value === 'string' && value.trim()) return value;
	}
	const first = Object.values(obj).find((v) => typeof v === 'string' && v.trim());
	return typeof first === 'string' ? first : '';
}

interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	input?: unknown;
}

/** The last block wins, so `last_activity` reflects the most recent thing Claude did in the turn. */
function activityFromBlocks(blocks: ContentBlock[]): string | null {
	let activity: string | null = null;
	for (const block of blocks) {
		if (block.type === 'tool_use' && typeof block.name === 'string') {
			const arg = summarizeToolInput(block.input);
			activity = arg ? `${block.name}(${truncate(arg)})` : block.name;
		} else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
			activity = truncate(block.text);
		}
	}
	return activity;
}

interface StreamEvent {
	type?: string;
	subtype?: string;
	session_id?: string;
	parent_tool_use_id?: string | null;
	message?: { content?: ContentBlock[] };
	error?: string;
	attempt?: number;
	result?: string;
	structured_output?: unknown;
	is_error?: boolean;
	num_turns?: number;
	total_cost_usd?: number;
	duration_ms?: number;
}

function applyEvent(state: RunStreamState, event: StreamEvent): void {
	if (typeof event.session_id === 'string' && !state.sessionId) state.sessionId = event.session_id;

	if (event.type === 'system' && event.subtype === 'api_retry') {
		state.lastActivity = `Retrying (${event.error ?? 'error'}), attempt ${event.attempt ?? 1}…`;
		return;
	}

	if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
		// Subagent chatter would otherwise drown out what the main loop is doing.
		if (event.parent_tool_use_id != null) return;
		const activity = activityFromBlocks(event.message.content);
		if (activity) state.lastActivity = activity;
		return;
	}

	if (event.type === 'result') {
		state.resultSeen = true;
		state.isError = event.is_error === true || event.subtype !== 'success';
		if (typeof event.result === 'string') state.result = event.result;
		if (event.structured_output !== undefined && event.structured_output !== null) {
			state.structuredOutput = JSON.stringify(event.structured_output);
		}
		if (typeof event.num_turns === 'number') state.numTurns = event.num_turns;
		if (typeof event.total_cost_usd === 'number') state.costUsd = event.total_cost_usd;
		if (typeof event.duration_ms === 'number') state.durationMs = event.duration_ms;
	}
}

/**
 * Folds a chunk of newline-delimited JSON into `state`, returning the incomplete trailing line for
 * the caller to prepend next time. A line that won't parse is skipped rather than fatal — a torn
 * write reappears whole on the following pass.
 */
export function readRunChunk(
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
			applyEvent(state, JSON.parse(trimmed) as StreamEvent);
		} catch {
			// Not a torn line but genuine garbage (a stray shell warning); ignore it.
		}
	}
	return { state, carry: tail };
}

/** Replays a whole mirror file — how a run's state is rebuilt after the manager restarts. */
export function readRunFile(text: string): RunStreamState {
	return readRunChunk(emptyRunState(), '', text).state;
}
