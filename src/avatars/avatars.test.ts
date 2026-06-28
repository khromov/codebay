import { describe, test, expect } from 'bun:test';
import { avatars, pickAvatar, decode } from './index.ts';

describe('avatar catalog', () => {
  test('has at least 30 sprites', () => {
    expect(avatars.length).toBeGreaterThanOrEqual(30);
  });

  test('every sprite is exactly 8×8 with only legal chars', () => {
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
});

describe('decode', () => {
  test('maps # → 2, + → 1, space/. → 0 and returns 64 cells', () => {
    const cells = decode(avatars[0]!);
    expect(cells.length).toBe(64);
    expect(cells.every((c) => c === 0 || c === 1 || c === 2)).toBe(true);
  });

  test('respects the legend on a known pattern', () => {
    const art = { name: 't', pixels: Array(8).fill('#+.# +.#') };
    const row = decode(art).slice(0, 8);
    // '#+.# +.#'
    expect(row).toEqual([2, 1, 0, 2, 0, 1, 0, 2]);
  });
});

describe('pickAvatar', () => {
  test('is deterministic across repeated calls', () => {
    const ids = ['550e8400-e29b-41d4-a716-446655440000', 'abc', '', crypto.randomUUID()];
    for (const id of ids) {
      expect(pickAvatar(id)).toBe(pickAvatar(id));
      expect(pickAvatar(id)).toBe(pickAvatar(id)); // and again
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
