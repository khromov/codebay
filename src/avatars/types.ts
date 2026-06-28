// A single 8×8 dot-matrix artwork for the LED/LCD avatar panel.
//
// `pixels` is exactly 8 strings of exactly 8 characters each. The legend below
// keeps the art human-editable: you can eyeball a creature in the source.
//
//   '#'        → on   (full ink,  --ink)
//   '+'        → dim  (half-tone, --ink-soft)  — outlines, eyes, shading
//   ' ' or '.' → off  (unlit pixel, faint tint)
export type AvatarArt = {
  name: string; // human label; also used for uniqueness + accessibility
  pixels: string[];
};

export const OFF = 0;
export const DIM = 1;
export const ON = 2;

export const ROWS = 8;
export const COLS = 8;

// Decode an artwork into a flat, row-major array of 64 intensities (0/1/2).
export function decode(art: AvatarArt): number[] {
  const cells: number[] = [];
  for (const row of art.pixels) {
    for (const ch of row) {
      cells.push(ch === '#' ? ON : ch === '+' ? DIM : OFF);
    }
  }
  return cells;
}
