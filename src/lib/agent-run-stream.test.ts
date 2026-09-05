import { describe, expect, test } from 'bun:test';
import { emptyRunState, parseRunTimeline, readRunChunk, readRunFile } from './agent-run-stream.ts';

const line = (o: unknown) => JSON.stringify(o) + '\n';

const init = line({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus' });
const toolUse = line({
	type: 'assistant',
	parent_tool_use_id: null,
	message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'bun test' } }] }
});
const result = line({
	type: 'result',
	subtype: 'success',
	is_error: false,
	result: 'Added the badge.',
	session_id: 'sess-1',
	num_turns: 7,
	total_cost_usd: 0.42,
	duration_ms: 84_000
});

describe('readRunChunk', () => {
	test('pulls the session id out of the init event', () => {
		expect(readRunFile(init).sessionId).toBe('sess-1');
	});

	test('summarises a tool call as name(argument)', () => {
		expect(readRunFile(init + toolUse).lastActivity).toBe('Bash(bun test)');
	});

	test('falls back to assistant text when there is no tool call', () => {
		const text = line({
			type: 'assistant',
			message: { content: [{ type: 'text', text: 'Looking at\nthe test suite' }] }
		});
		expect(readRunFile(text).lastActivity).toBe('Looking at the test suite');
	});

	test('ignores subagent chatter so the main loop stays visible', () => {
		const subagent = line({
			type: 'assistant',
			parent_tool_use_id: 'toolu_1',
			message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x.ts' } }] }
		});
		expect(readRunFile(init + toolUse + subagent).lastActivity).toBe('Bash(bun test)');
	});

	test('surfaces an api retry', () => {
		const retry = line({ type: 'system', subtype: 'api_retry', attempt: 2, error: 'rate_limit' });
		expect(readRunFile(retry).lastActivity).toBe('Retrying (rate_limit), attempt 2…');
	});

	test('maps the terminal result event', () => {
		const state = readRunFile(init + toolUse + result);
		expect(state).toMatchObject({
			resultSeen: true,
			isError: false,
			result: 'Added the badge.',
			numTurns: 7,
			costUsd: 0.42,
			durationMs: 84_000
		});
	});

	test('treats a non-success subtype as an error even without is_error', () => {
		const maxTurns = line({ type: 'result', subtype: 'error_max_turns', num_turns: 30 });
		expect(readRunFile(maxTurns)).toMatchObject({ resultSeen: true, isError: true, result: null });
	});

	test('serialises structured_output rather than dropping it', () => {
		const structured = line({
			type: 'result',
			subtype: 'success',
			structured_output: { functions: ['a', 'b'] }
		});
		expect(readRunFile(structured).structuredOutput).toBe('{"functions":["a","b"]}');
	});

	test('carries an incomplete trailing line to the next chunk', () => {
		// The poller tails raw bytes, so a chunk routinely stops mid-object.
		const whole = init + toolUse;
		const cut = whole.length - 20;
		const first = readRunChunk(emptyRunState(), '', whole.slice(0, cut));
		expect(first.state.lastActivity).toBeNull();
		expect(first.carry).not.toBe('');

		const second = readRunChunk(first.state, first.carry, whole.slice(cut));
		expect(second.state.lastActivity).toBe('Bash(bun test)');
		expect(second.carry).toBe('');
	});

	test('skips a line that is genuine garbage without losing the rest', () => {
		expect(readRunFile(init + 'bash: warning: setlocale failed\n' + result).result).toBe(
			'Added the badge.'
		);
	});

	test('truncates a long activity string to one line', () => {
		const long = line({
			type: 'assistant',
			message: {
				content: [{ type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(500) } }]
			}
		});
		const activity = readRunFile(long).lastActivity!;
		expect(activity.length).toBeLessThanOrEqual(140);
		expect(activity).toContain('…');
	});
});

describe('parseRunTimeline', () => {
	test('keeps every step, where readRunChunk keeps only the latest', () => {
		const text =
			init +
			toolUse +
			line({
				type: 'assistant',
				message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }] }
			}) +
			result;
		const rows = parseRunTimeline(text);
		expect(rows.map((r) => `${r.kind}:${r.name ?? ''}`)).toEqual([
			'tool:Bash',
			'tool:Read',
			'result:'
		]);
		// The poller keeps only the last *action* in last_activity; the closing text is `result`.
		const state = readRunFile(text);
		expect(state.lastActivity).toBe('Read(/a.ts)');
		expect(state.result).toBe('Added the badge.');
	});

	test('marks subagent steps rather than dropping them', () => {
		const rows = parseRunTimeline(
			line({
				type: 'assistant',
				parent_tool_use_id: 'toolu_1',
				message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'x' } }] }
			})
		);
		expect(rows).toEqual([{ kind: 'tool', name: 'Grep', text: 'x', subagent: true }]);
	});

	test('flags a failed result so the panel can show a cross', () => {
		const rows = parseRunTimeline(line({ type: 'result', subtype: 'error_max_turns' }));
		expect(rows[0]).toMatchObject({ kind: 'result', isError: true });
	});

	test('splits a multi-block message into one row per block', () => {
		const rows = parseRunTimeline(
			line({
				type: 'assistant',
				message: {
					content: [
						{ type: 'text', text: 'Let me look.' },
						{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }
					]
				}
			})
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ kind: 'text', text: 'Let me look.' });
		expect(rows[1]).toMatchObject({ kind: 'tool', name: 'Bash', text: 'ls' });
	});
});

test('the result row supersedes an identical closing text row rather than repeating it', () => {
	// Claude emits its closing message as both a final assistant text block and the result event.
	const closing = 'All three done.';
	const rows = parseRunTimeline(
		line({ type: 'assistant', message: { content: [{ type: 'text', text: closing }] } }) +
			line({ type: 'result', subtype: 'success', is_error: false, result: closing })
	);
	expect(rows).toEqual([{ kind: 'result', text: closing, isError: false }]);
});

test('keeps a closing text row that differs from the result', () => {
	const rows = parseRunTimeline(
		line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking…' }] } }) +
			line({ type: 'result', subtype: 'success', is_error: false, result: 'Done.' })
	);
	expect(rows.map((r) => r.kind)).toEqual(['text', 'result']);
});
