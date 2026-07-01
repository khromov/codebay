// A single 8×8 dot-matrix artwork for the LED/LCD avatar panel.
//
// `pixels` is exactly 8 strings of exactly 8 characters each. The legend below
// keeps the art human-editable: you can eyeball a creature in the source.
// Pixels are purely on/off — a lit dot is ink, everything else is unlit.
//
//   '#'        → on  (lit pixel, --ink)
//   ' ' or '.' → off (unlit pixel, faint tint)
export type AvatarArt = {
	name: string; // human label; also used for uniqueness + accessibility
	pixels: string[];
};

export const OFF = 0;
export const ON = 1;

export const ROWS = 8;
export const COLS = 8;

// Decode an artwork into a flat, row-major array of 64 on/off cells (0 or 1).
export function decode(art: AvatarArt): number[] {
	const cells: number[] = [];
	for (const row of art.pixels) {
		for (const ch of row) {
			cells.push(ch === '#' ? ON : OFF);
		}
	}
	return cells;
}
