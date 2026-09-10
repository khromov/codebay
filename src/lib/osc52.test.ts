import { describe, expect, test } from 'bun:test';
import { parseOsc52 } from './osc52.ts';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('parseOsc52', () => {
	test('decodes the clipboard selection', () => {
		expect(parseOsc52(`c;${b64('hello')}`)).toBe('hello');
	});

	test('decodes tmux’s empty selection field', () => {
		expect(parseOsc52(`;${b64('echo HELLOWORLD')}`)).toBe('echo HELLOWORLD');
	});

	test('round-trips multi-byte text', () => {
		expect(parseOsc52(`c;${b64('café — テスト')}`)).toBe('café — テスト');
	});

	test('ignores the report form', () => {
		expect(parseOsc52('c;?')).toBeNull();
	});

	test('ignores an empty payload', () => {
		expect(parseOsc52('c;')).toBeNull();
	});

	test('ignores a payload with no selection separator', () => {
		expect(parseOsc52(b64('hello'))).toBeNull();
	});

	test('ignores malformed base64', () => {
		expect(parseOsc52('c;not base64!!')).toBeNull();
	});
});
