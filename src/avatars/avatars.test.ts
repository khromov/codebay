import { describe, test, expect } from 'bun:test';
import { avatars, pickAvatar, pickUniqueAvatar, findAvatar, decode } from './index.ts';

describe('avatar catalog', () => {
	test('has at least 30 sprites', () => {
		expect(avatars.length).toBeGreaterThanOrEqual(30);
	});

	test('every sprite is exactly 8×8 with only legend chars (#, +, ., space)', () => {
		for (const art of avatars) {
			expect(art.pixels.length).toBe(8);
			for (const row of art.pixels) {
				expect(row.length).toBe(8);
				expect(row).toMatch(/^[#+. ]{8}$/);
			}
		}
	});

	test('sprite names are unique and non-empty', () => {
		const names = avatars.map((a) => a.name);
		expect(names.every((n) => n.length > 0)).toBe(true);
		expect(new Set(names).size).toBe(names.length);
	});

	// The flagged set is a subset of the original AI batch (commit fda8e80): a hand-redraw
	// drops the flag, so the set can only shrink — never grow, and never flag a non-original.
	test('robot flag only ever marks (a subset of) the original AI-generated sprites', () => {
		const original = [
			'anchor',
			'bear',
			'bee',
			'cat',
			'cherry',
			'crab',
			'crown',
			'diamond',
			'dog',
			'fish',
			'flower',
			'fox',
			'frog',
			'ghost',
			'invader',
			'key',
			'lightning',
			'mushroom',
			'octopus',
			'owl',
			'penguin',
			'planet',
			'rabbit',
			'robot',
			'rocket',
			'snail',
			'star',
			'target',
			'tree',
			'whale'
		].sort();
		const originalSet = new Set(original);
		const flagged = avatars.filter((a) => a.robot).map((a) => a.name);
		for (const name of flagged) expect(originalSet.has(name)).toBe(true);
	});
});

describe('findAvatar', () => {
	test('returns the sprite with the given name', () => {
		const art = avatars[3]!;
		expect(findAvatar(art.name)).toBe(art);
	});

	// A pet cookie can outlive the sprite it names, so an unknown name must not throw.
	test('returns undefined for unknown or missing names', () => {
		expect(findAvatar('definitely-not-a-sprite')).toBeUndefined();
		expect(findAvatar(undefined)).toBeUndefined();
		expect(findAvatar('')).toBeUndefined();
	});
});

describe('decode', () => {
	test('maps # → 1, + → 2, space/. → 0 and returns 64 cells', () => {
		const cells = decode(avatars[0]!);
		expect(cells.length).toBe(64);
		expect(cells.every((c) => c === 0 || c === 1 || c === 2)).toBe(true);
	});

	test('respects the legend on a known pattern', () => {
		const art = { name: 't', pixels: Array(8).fill('#..# .##') };
		const row = decode(art).slice(0, 8);
		// '#..# .##'
		expect(row).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
	});

	test('maps the gray char + to 2', () => {
		const art = { name: 'g', pixels: Array(8).fill('#+.+ +.#') };
		const row = decode(art).slice(0, 8);
		// '#+.+ +.#'
		expect(row).toEqual([1, 2, 0, 2, 0, 2, 0, 1]);
	});
});

describe('pickAvatar', () => {
	test('is deterministic across repeated calls', () => {
		const ids = ['550e8400-e29b-41d4-a716-446655440000', 'abc', '', crypto.randomUUID()];
		for (const id of ids) {
			expect(pickAvatar(id)).toBe(pickAvatar(id));
			expect(pickAvatar(id)).toBe(pickAvatar(id));
		}
	});

	test('always returns a catalog member', () => {
		for (let i = 0; i < 50; i++) {
			expect(avatars).toContain(pickAvatar(crypto.randomUUID()));
		}
	});

	test('spreads UUIDs across most of the catalog (no degenerate clustering)', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 3000; i++) {
			seen.add(pickAvatar(crypto.randomUUID()).name);
		}
		// With 3000 random ids over ~32 buckets, every sprite should realistically appear.
		expect(seen.size).toBe(avatars.length);
	});
});

describe('pickUniqueAvatar', () => {
	test('matches pickAvatar when nothing is taken', () => {
		for (let i = 0; i < 50; i++) {
			const id = crypto.randomUUID();
			expect(pickUniqueAvatar(id, [])).toBe(pickAvatar(id));
		}
	});

	test('avoids a taken sprite but still returns a catalog member', () => {
		for (let i = 0; i < 50; i++) {
			const id = crypto.randomUUID();
			const hashed = pickAvatar(id);
			const chosen = pickUniqueAvatar(id, [hashed.name]);
			expect(chosen).not.toBe(hashed);
			expect(avatars).toContain(chosen);
		}
	});

	test('assigns a distinct sprite to every instance while the catalog has room', () => {
		const taken: string[] = [];
		// One shy of the catalog size, so a free sprite always remains.
		for (let i = 0; i < avatars.length - 1; i++) {
			taken.push(pickUniqueAvatar(crypto.randomUUID(), taken).name);
		}
		expect(new Set(taken).size).toBe(taken.length);
	});

	test('falls back to the hashed pick once every sprite is taken', () => {
		const all = avatars.map((a) => a.name);
		const id = crypto.randomUUID();
		expect(pickUniqueAvatar(id, all)).toBe(pickAvatar(id));
	});
});
