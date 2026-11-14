// The string legend keeps the art human-editable — you can eyeball a creature in the source.
//
//   '#'        → on   (lit pixel)
//   '+'        → gray (half-lit pixel)
//   ' ' or '.' → off  (unlit pixel)
export type AvatarArt = {
	name: string; // also the uniqueness key
	pixels: string[];
	robot?: boolean; // true for the original AI-generated sprites, slated to be redrawn by hand
};

export const OFF = 0;
export const ON = 1;
export const GRAY = 2;

export const ROWS = 8;
export const COLS = 8;

export function decode(art: AvatarArt): number[] {
	const cells: number[] = [];
	for (const row of art.pixels) {
		for (const ch of row) {
			cells.push(ch === '#' ? ON : ch === '+' ? GRAY : OFF);
		}
	}
	return cells;
}
