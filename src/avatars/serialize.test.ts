import { describe, test, expect } from 'bun:test';
import { decode } from './types.ts';
import { cellsToPixels, toModuleSource, toIssueUrl, normalizeName, REPO_URL } from './serialize.ts';
import cat from './cat.ts';

describe('normalizeName', () => {
	test('slugs arbitrary input to lowercase [a-z0-9-]', () => {
		expect(normalizeName('  Space Dragon! ')).toBe('space-dragon');
		expect(normalizeName('cat')).toBe('cat');
		expect(normalizeName("'; DROP")).toBe('drop');
		expect(normalizeName('---')).toBe('');
		expect(normalizeName('')).toBe('');
	});
});

describe('cellsToPixels', () => {
	test('round-trips with decode', () => {
		expect(cellsToPixels(decode(cat))).toEqual(cat.pixels);
	});

	test('emits 8 rows of 8 with only # and .', () => {
		const rows = cellsToPixels(Array(64).fill(0).fill(1, 0, 3));
		expect(rows.length).toBe(8);
		for (const row of rows) expect(row).toMatch(/^[#.]{8}$/);
		expect(rows[0]).toBe('###.....');
	});
});

describe('toModuleSource', () => {
	test('byte-equals the checked-in cat.ts for cat art', async () => {
		const source = await Bun.file(new URL('./cat.ts', import.meta.url)).text();
		expect(toModuleSource(cat)).toBe(source);
	});
});

describe('toIssueUrl', () => {
	test('targets the repo new-issue page with recoverable title and body', () => {
		const art = { name: 'dragon', pixels: cellsToPixels(decode(cat)) };
		const url = new URL(toIssueUrl(art));
		expect(url.origin + url.pathname).toBe(`${REPO_URL}/issues/new`);
		expect(url.searchParams.get('title')).toBe('Avatar contribution: dragon');
		const body = url.searchParams.get('body') ?? '';
		for (const row of art.pixels) expect(body).toContain(row);
		expect(body).toContain(toModuleSource(art).trimEnd());
	});
});
