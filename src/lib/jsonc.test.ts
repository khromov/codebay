import { describe, expect, test } from 'bun:test';
import { stripJsonc } from './jsonc.ts';

const parse = (raw: string) => JSON.parse(stripJsonc(raw));

describe('stripJsonc', () => {
	test('strips line and block comments', () => {
		expect(
			parse(`{
        // a line comment
        "a": 1, /* inline */
        /* a
           block comment */
        "b": 2
      }`)
		).toEqual({ a: 1, b: 2 });
	});

	test('strips trailing commas in objects and arrays', () => {
		expect(parse('{ "a": [1, 2, 3, ], }')).toEqual({ a: [1, 2, 3] });
	});

	test('leaves comment- and comma-looking text inside strings alone', () => {
		expect(parse('{ "a": "http://x//y", "b": "1, 2, /* not a comment */" }')).toEqual({
			a: 'http://x//y',
			b: '1, 2, /* not a comment */'
		});
	});

	test('respects escaped quotes when tracking string boundaries', () => {
		expect(parse('{ "a": "say \\"hi\\" // not a comment" }')).toEqual({
			a: 'say "hi" // not a comment'
		});
	});
});
