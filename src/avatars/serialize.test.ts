import { describe, test, expect } from 'bun:test';
import { decode } from './types.ts';
import { cellsToPixels, toModuleSource, toIssueUrl, normalizeName, REPO_URL } from './serialize.ts';
// A community sprite (no `robot` flag) — representative of what the editor's contribution flow emits.
import ukraine from './ukraine.ts';

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
		expect(cellsToPixels(decode(ukraine))).toEqual(ukraine.pixels);
	});

	test('emits 8 rows of 8 with only #, + and .', () => {
		const rows = cellsToPixels(Array(64).fill(0).fill(1, 0, 3));
		expect(rows.length).toBe(8);
		for (const row of rows) expect(row).toMatch(/^[#+.]{8}$/);
		expect(rows[0]).toBe('###.....');
	});

	test('serializes gray cells (2) to + and round-trips through decode', () => {
		const cells = Array(64).fill(0);
		cells[0] = 1; // on → #
		cells[1] = 2; // gray → +
		const rows = cellsToPixels(cells);
		expect(rows[0]).toBe('#+......');
		expect(decode({ name: 'x', pixels: rows })).toEqual(cells);
	});
});

describe('toModuleSource', () => {
	test('byte-equals the checked-in ukraine.ts for ukraine art', async () => {
		const source = await Bun.file(new URL('./ukraine.ts', import.meta.url)).text();
		expect(toModuleSource(ukraine)).toBe(source);
	});
});

describe('toIssueUrl', () => {
	test('targets the repo new-issue page with recoverable title and body', () => {
		const art = { name: 'dragon', pixels: cellsToPixels(decode(ukraine)) };
		const url = new URL(toIssueUrl(art));
		expect(url.origin + url.pathname).toBe(`${REPO_URL}/issues/new`);
		expect(url.searchParams.get('title')).toBe('Avatar contribution: dragon');
		const body = url.searchParams.get('body') ?? '';
		for (const row of art.pixels) expect(body).toContain(row);
		expect(body).toContain(toModuleSource(art).trimEnd());
	});
});
