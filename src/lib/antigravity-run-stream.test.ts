import { describe, expect, test } from 'bun:test';
import { emptyRunState } from './agent-run-stream.ts';
import {
	parseAntigravityTimeline,
	readAntigravityRunChunk,
	readAntigravityRunFile
} from './antigravity-run-stream.ts';

const line = (o: unknown) => JSON.stringify(o) + '\n';

const init = line({
	event: 'init',
	conversation_id: 'conv-1',
	init: {
		cwd: '/workspaces/app',
		tools: ['run_command', 'write_to_file'],
		permission_mode: 'always-proceed',
		model: 'gemini-4-neon-xhigh'
	}
});

const toolDone = line({
	event: 'step_update',
	step_update: {
		conversation_id: 'conv-1',
		step_index: 2,
		state: 'DONE',
		step_type: 'tool',
		tool_name: 'run_command',
		tool_info: {
			name: 'run_command',
			parameters: { CommandLine: 'bun test' },
			output: 'ok\n'
		}
	}
});

const resultOk = line({
	event: 'result',
	result: {
		conversation_id: 'conv-1',
		status: 'SUCCESS',
		response: 'All tests passed.\n',
		duration_seconds: 6.88,
		num_turns: 3,
		usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }
	}
});

describe('readAntigravityRunChunk', () => {
	test('extracts conversation_id and model from init', () => {
		const state = readAntigravityRunFile(init);
		expect(state.sessionId).toBe('conv-1');
		expect(state.model).toBe('gemini-4-neon-xhigh');
	});

	test('summarises Antigravity PascalCase tool calls and subagent invocations', () => {
		expect(readAntigravityRunFile(init + toolDone).lastActivity).toBe('run_command(bun test)');

		const sub = line({
			event: 'step_update',
			step_update: {
				step_index: 3,
				state: 'ACTIVE',
				step_type: 'tool',
				tool_name: 'invoke_subagent',
				subagent_info: {
					subagents: [{ type_name: 'research', role: 'Codebase Researcher' }]
				}
			}
		});
		expect(readAntigravityRunFile(init + sub).lastActivity).toBe(
			'invoke_subagent(Codebase Researcher)'
		);
	});

	test('accumulates streaming agent_response text_delta fragments across chunks', () => {
		const d1 = line({
			event: 'step_update',
			step_update: {
				step_index: 4,
				state: 'ACTIVE',
				step_type: 'agent_response',
				text_delta: 'Checking '
			}
		});
		const d2 = line({
			event: 'step_update',
			step_update: {
				step_index: 4,
				state: 'DONE',
				step_type: 'agent_response',
				text_delta: 'the build.\n'
			}
		});
		const whole = d1 + d2;
		const cut = whole.length - 15;
		const first = readAntigravityRunChunk(emptyRunState(), '', whole.slice(0, cut));
		expect(first.state.lastActivity).toBe('Checking');
		expect(first.carry).not.toBe('');

		const second = readAntigravityRunChunk(first.state, first.carry, whole.slice(cut));
		expect(second.state.lastActivity).toBe('Checking the build.');
		expect(second.state.lastAssistantText).toBe('Checking the build.');
		expect(second.carry).toBe('');
	});

	test('maps SUCCESS result with duration_seconds, num_turns, and structured_output', () => {
		const structured = line({
			event: 'result',
			result: {
				conversation_id: 'conv-2',
				status: 'SUCCESS',
				response: '{"ok":true}\n',
				structured_output: { ok: true },
				duration_seconds: 4.45,
				num_turns: 1
			}
		});
		const state = readAntigravityRunFile(structured);
		expect(state).toMatchObject({
			sessionId: 'conv-2',
			resultSeen: true,
			isError: false,
			result: '{"ok":true}',
			structuredOutput: '{"ok":true}',
			durationMs: 4450,
			numTurns: 1,
			errorMessage: null
		});
	});

	test('maps ERROR result status and errorMessage', () => {
		const err = line({
			event: 'result',
			result: {
				conversation_id: '',
				status: 'ERROR',
				response: '',
				error: 'invalid model selection',
				duration_seconds: 0.1,
				num_turns: 0
			}
		});
		const state = readAntigravityRunFile(err);
		expect(state).toMatchObject({
			resultSeen: true,
			isError: true,
			errorMessage: 'invalid model selection',
			result: null
		});
	});
});

describe('parseAntigravityTimeline', () => {
	test('coalesces incremental text_delta and ACTIVE->DONE tool updates per step_index', () => {
		const stream =
			init +
			line({
				event: 'step_update',
				step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' }
			}) +
			line({
				event: 'step_update',
				step_update: {
					step_index: 1,
					state: 'ACTIVE',
					step_type: 'tool',
					tool_name: 'run_command',
					tool_info: { name: 'run_command', parameters: { CommandLine: 'bun test' } }
				}
			}) +
			line({
				event: 'step_update',
				step_update: {
					step_index: 1,
					state: 'DONE',
					step_type: 'tool',
					tool_name: 'run_command',
					tool_info: {
						name: 'run_command',
						parameters: { CommandLine: 'bun test' },
						output: 'pass'
					}
				}
			}) +
			line({
				event: 'step_update',
				step_update: {
					step_index: 2,
					state: 'ACTIVE',
					step_type: 'agent_response',
					text_delta: 'All tests '
				}
			}) +
			line({
				event: 'step_update',
				step_update: {
					step_index: 2,
					state: 'DONE',
					step_type: 'agent_response',
					text_delta: 'passed.\n'
				}
			}) +
			line({
				event: 'step_update',
				step_update: { step_index: 3, state: 'DONE', step_type: 'checkpoint' }
			}) +
			resultOk;

		const rows = parseAntigravityTimeline(stream);
		// Closing agent_response matches result text, so result supersedes it rather than repeating.
		expect(rows).toEqual([
			{ kind: 'tool', name: 'run_command', text: 'bun test' },
			{ kind: 'result', text: 'All tests passed.', isError: false }
		]);
	});

	test('surfaces tool errors and failed result messages', () => {
		const stream =
			line({
				event: 'step_update',
				step_update: {
					step_index: 1,
					state: 'DONE',
					step_type: 'tool',
					tool_name: 'run_command',
					tool_info: {
						name: 'run_command',
						parameters: { CommandLine: 'false' },
						error: { type: 'exit', message: 'exit 1' }
					}
				}
			}) +
			line({
				event: 'result',
				result: { status: 'ERROR', response: '', error: 'authentication required' }
			});

		expect(parseAntigravityTimeline(stream)).toEqual([
			{ kind: 'tool', name: 'run_command', text: 'false', isError: true },
			{ kind: 'result', text: 'authentication required', isError: true }
		]);
	});
});
