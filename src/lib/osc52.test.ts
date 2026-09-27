import { describe, expect, test } from 'bun:test';
import { decodeOsc52 } from './osc52.ts';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('decodeOsc52', () => {
	test('decodes the clipboard selection tmux sends', () => {
		expect(decodeOsc52(`c;${b64('hello from tmux')}`)).toBe('hello from tmux');
	});

	test('accepts any selection target, not just c', () => {
		expect(decodeOsc52(`p;${b64('primary')}`)).toBe('primary');
		expect(decodeOsc52(`;${b64('default')}`)).toBe('default');
	});

	test('round-trips multi-line and non-ASCII payloads', () => {
		const text = 'line one\nline twö — ✓\n';
		expect(decodeOsc52(`c;${b64(text)}`)).toBe(text);
	});

	test('tolerates base64 split across the sequence', () => {
		expect(decodeOsc52(`c;${b64('wrapped')}\n \t`)).toBe('wrapped');
	});

	test('refuses a read request so the host clipboard never leaks into the container', () => {
		expect(decodeOsc52('c;?')).toBeNull();
	});

	test('returns null for malformed input rather than throwing', () => {
		expect(decodeOsc52('c;not base64!!')).toBeNull();
		expect(decodeOsc52('no-separator')).toBeNull();
		expect(decodeOsc52('c;')).toBeNull();
	});
});
