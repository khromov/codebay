import { afterEach, describe, expect, test } from 'bun:test';
import {
	EXEC_STDIN_MAX_BYTES,
	afterMarker,
	execInContainer,
	execTargetFor,
	markerLine
} from './exec.server.ts';

const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };

afterEach(() => {
	g.__codebayDocker = undefined;
});

describe('execInContainer', () => {
	test('refuses a payload the kernel would reject, before any exec is attempted', async () => {
		let execs = 0;
		g.__codebayDocker = Promise.resolve({
			getContainer: () => ({
				exec: async () => {
					execs++;
					throw new Error('should not be reached');
				}
			})
		});
		const res = await execInContainer(
			{ containerId: 'c' },
			{ script: 'true', stdin: 'x'.repeat(EXEC_STDIN_MAX_BYTES + 1) }
		);
		expect(res.ok).toBe(false);
		expect(res.error).toContain(`${EXEC_STDIN_MAX_BYTES}-byte limit`);
		expect(execs).toBe(0);
	});

	test('measures the limit in UTF-8 bytes, not characters', async () => {
		g.__codebayDocker = Promise.resolve({
			getContainer: () => ({
				exec: async () => {
					throw new Error('should not be reached');
				}
			})
		});
		// Each of these is one character but three bytes.
		const res = await execInContainer(
			{ containerId: 'c' },
			{ script: 'true', stdin: '€'.repeat(Math.ceil(EXEC_STDIN_MAX_BYTES / 3) + 1) }
		);
		expect(res.ok).toBe(false);
		expect(res.error).toContain('exceeds');
	});
});

describe('marker parsing', () => {
	const noisy = 'bash: warning: setlocale failed\n__M__first\n__M__\tsecond\r\ntrailing';

	test('afterMarker takes everything past the last marker', () => {
		expect(afterMarker(noisy, '__M__')).toBe('\tsecond\r\ntrailing');
		expect(afterMarker('nothing here', '__M__')).toBeNull();
	});

	test('markerLine keeps the line untrimmed apart from a CR, so an empty leading field survives', () => {
		expect(markerLine(noisy, '__M__')).toBe('\tsecond');
		expect(markerLine('__M__only', '__M__')).toBe('only');
		expect(markerLine('none', '__M__')).toBeNull();
	});
});

test('execTargetFor carries the resolved remote user through', () => {
	expect(execTargetFor({ container_id: 'abc', remote_user: 'node' })).toEqual({
		containerId: 'abc',
		remoteUser: 'node'
	});
});
