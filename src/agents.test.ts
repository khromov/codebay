import { expect, test } from 'bun:test';
import {
	agentsFor,
	normalizeAgentSelection,
	preferredAgent,
	codexPermissionFlags
} from './agents.ts';
import {
	emptyRunState,
	readRunChunk,
	readRunFile,
	parseRunTimeline
} from './lib/agent-run-stream.ts';

test('Claude stays the default; both installs both but resolves one launch preference', () => {
	expect(normalizeAgentSelection(undefined)).toBe('claude');
	expect(normalizeAgentSelection('invalid')).toBe('claude');
	expect(agentsFor('both')).toEqual(['claude', 'codex']);
	expect(preferredAgent('both')).toBe('claude');
	expect(preferredAgent('both', 'codex')).toBe('codex');
	expect(preferredAgent('codex', 'claude')).toBe('codex');
	expect(codexPermissionFlags('full-access')).toBe('--dangerously-bypass-approvals-and-sandbox');
	expect(codexPermissionFlags('workspace')).toContain('--sandbox workspace-write');
});

const events = [
	{ type: 'thread.started', thread_id: 'codex-session' },
	{ type: 'turn.started' },
	{
		type: 'item.started',
		item: { id: '1', type: 'command_execution', command: 'bun test', status: 'in_progress' }
	},
	{
		type: 'item.completed',
		item: {
			id: '1',
			type: 'command_execution',
			command: 'bun test',
			status: 'completed',
			aggregated_output: 'passed'
		}
	},
	{ type: 'item.completed', item: { id: '2', type: 'agent_message', text: 'Done ✓' } },
	{
		type: 'turn.completed',
		usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30 }
	}
]
	.map((event) => JSON.stringify(event) + '\n')
	.join('');

test('Codex event folding survives every chunk boundary and keeps native usage', () => {
	const expected = readRunFile(events, 'codex');
	for (let split = 0; split <= events.length; split++) {
		let cursor = readRunChunk(emptyRunState(), '', events.slice(0, split), 'codex');
		cursor = readRunChunk(cursor.state, cursor.carry, events.slice(split), 'codex');
		expect(cursor.state).toEqual(expected);
	}
	expect(expected).toMatchObject({
		sessionId: 'codex-session',
		result: 'Done ✓',
		resultSeen: true,
		isError: false,
		costUsd: null,
		tokenUsage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30 }
	});
});

test('Codex timeline updates an existing item instead of duplicating each progress event', () => {
	expect(parseRunTimeline(events, 'codex')).toMatchObject([
		{ kind: 'tool', text: 'bun test' },
		{ kind: 'text', text: 'Done ✓' }
	]);
});

test('Codex failures and malformed events do not become successful empty runs', () => {
	const state = readRunFile(
		'not json\nnull\n' +
			JSON.stringify({ type: 'turn.failed', error: { message: 'Not signed in' } }) +
			'\n',
		'codex'
	);
	expect(state).toMatchObject({ isError: true, resultSeen: true, result: 'Not signed in' });
	expect(readRunFile('{}\n', 'codex').resultSeen).toBe(false);
});

test('Codex recovers from a stream retry and exposes native diagnostic items', () => {
	const retry = JSON.stringify({ type: 'error', message: 'Reconnecting' }) + '\n';
	expect(readRunFile(retry + events, 'codex')).toMatchObject({ isError: false, result: 'Done ✓' });
	const diagnostic = JSON.stringify({
		type: 'item.completed',
		item: { type: 'error', message: 'Model metadata unavailable' }
	});
	expect(parseRunTimeline(diagnostic, 'codex')).toMatchObject([
		{ kind: 'text', text: 'Model metadata unavailable', isError: true }
	]);
});
