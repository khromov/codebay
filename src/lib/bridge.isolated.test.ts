import { describe, expect, test } from 'bun:test';
import { clearTask, getTask, setTask } from './bridge.server.ts';

describe('task store', () => {
	test('round-trips the latest prompt as an instance task', () => {
		setTask('inst-task-1', 'Add rate limiting to the API');
		expect(getTask('inst-task-1')).toBe('Add rate limiting to the API');
	});

	test('collapses whitespace so a multi-line prompt renders as one line', () => {
		setTask('inst-task-2', '  Fix the\n  flaky   auth\ttest  ');
		expect(getTask('inst-task-2')).toBe('Fix the flaky auth test');
	});

	test('caps an overlong prompt so the in-memory map stays bounded', () => {
		setTask('inst-task-3', 'x'.repeat(1000));
		expect(getTask('inst-task-3')!.length).toBe(500);
	});

	test('an empty or whitespace-only prompt leaves the task untouched', () => {
		setTask('inst-task-4', 'real task');
		setTask('inst-task-4', '   ');
		expect(getTask('inst-task-4')).toBe('real task');
	});

	test('clearTask drops it; an unknown id reads as null', () => {
		setTask('inst-task-5', 'something');
		clearTask('inst-task-5');
		expect(getTask('inst-task-5')).toBeNull();
		expect(getTask('never-set')).toBeNull();
	});
});
