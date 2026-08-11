import { describe, expect, test } from 'bun:test';
import { CMD_OUTPUT, decodeClientFrame, encodeOutput } from './terminal-frames.ts';

/**
 * These assertions are written against the exact bytes `TerminalPane.svelte` puts on the wire, so
 * that the host PTY route and the proxied ttyd can never drift apart under one shared client.
 */
describe('decodeClientFrame', () => {
	test("reads the client's opening JSON as the initial geometry", () => {
		expect(decodeClientFrame(JSON.stringify({ AuthToken: '', columns: 120, rows: 40 }))).toEqual({
			type: 'init',
			cols: 120,
			rows: 40
		});
	});

	test("treats a '0' prefix as keyboard input and keeps the payload verbatim", () => {
		expect(decodeClientFrame('0ls -la\r')).toEqual({ type: 'input', data: 'ls -la\r' });
		// A bare command byte is a legitimate empty write, not a malformed frame.
		expect(decodeClientFrame('0')).toEqual({ type: 'input', data: '' });
	});

	test("treats a '1' prefix as a resize", () => {
		expect(decodeClientFrame('1' + JSON.stringify({ columns: 80, rows: 24 }))).toEqual({
			type: 'resize',
			cols: 80,
			rows: 24
		});
	});

	test('rejects malformed and out-of-range geometry rather than passing it to the PTY', () => {
		for (const raw of [
			'1{not json',
			'1' + JSON.stringify({ columns: 0, rows: 24 }),
			'1' + JSON.stringify({ columns: 80, rows: -1 }),
			'1' + JSON.stringify({ columns: 80.5, rows: 24 }),
			'1' + JSON.stringify({ rows: 24 }),
			'{"columns":"eighty","rows":24}'
		]) {
			expect(decodeClientFrame(raw).type).toBe('unknown');
		}
	});

	test('ignores empty frames and unknown command bytes', () => {
		expect(decodeClientFrame('')).toEqual({ type: 'unknown' });
		// ttyd's own SET_WINDOW_TITLE/SET_PREFERENCES neighbours, which we never act on.
		expect(decodeClientFrame('2something')).toEqual({ type: 'unknown' });
	});
});

describe('encodeOutput', () => {
	test('prefixes the OUTPUT command byte the client strips back off', () => {
		const frame = encodeOutput(new TextEncoder().encode('hi'));
		expect(frame[0]).toBe(CMD_OUTPUT);
		expect(new TextDecoder().decode(frame.subarray(1))).toBe('hi');
	});

	test('round-trips arbitrary bytes, including NUL and high bytes', () => {
		const data = new Uint8Array([0x00, 0x1b, 0x5b, 0x41, 0xff]);
		expect(Array.from(encodeOutput(data).subarray(1))).toEqual(Array.from(data));
	});

	test('handles an empty chunk without emitting a bare prefix-less frame', () => {
		expect(Array.from(encodeOutput(new Uint8Array(0)))).toEqual([CMD_OUTPUT]);
	});
});
