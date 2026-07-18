// Turns a drawing from the avatar-editor easter egg into contribution
// artifacts: the exact module source a sprite ships as in this directory, and a
// pre-filled GitHub issue URL for submitting it to the official catalog.
import { type AvatarArt, ROWS, COLS, ON } from './types.ts';

export const REPO_URL = 'https://github.com/khromov/codebay';

// Contributed names must be usable as a filename and a catalog key, so squash
// anything the user types into a short lowercase slug ('' if nothing survives).
export function normalizeName(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// 64 row-major on/off cells → 8 pixel rows in the sprite legend ('#' / '.').
export function cellsToPixels(cells: number[]): string[] {
	const rows: string[] = [];
	for (let r = 0; r < ROWS; r++) {
		let row = '';
		for (let c = 0; c < COLS; c++) {
			row += cells[r * COLS + c] === ON ? '#' : '.';
		}
		rows.push(row);
	}
	return rows;
}

// The ready-to-paste module — byte-identical to the hand-written sprites in
// this directory (tabs, single quotes, trailing newline) so a maintainer can
// drop it in as src/avatars/<name>.ts and prettier won't touch it.
export function toModuleSource(art: AvatarArt): string {
	const rows = art.pixels.map((row) => `\t\t'${row}'`).join(',\n');
	return `import type { AvatarArt } from './types.ts';

const art: AvatarArt = {
\tname: '${art.name}',
\tpixels: [
${rows}
\t]
};

export default art;
`;
}

// A new-issue URL with the title and body pre-filled, so contributing is one
// click after drawing. The art is ~64 chars, far below any URL length limit.
export function toIssueUrl(art: AvatarArt): string {
	const title = `Avatar contribution: ${art.name}`;
	const body = [
		"Hi! I drew this avatar in the editor easter egg and I'd love to see it in the official set.",
		'',
		'```',
		...art.pixels,
		'```',
		'',
		`Ready-to-paste module (\`src/avatars/${art.name}.ts\`, plus a line in \`src/avatars/index.ts\`):`,
		'',
		'```ts',
		toModuleSource(art).trimEnd(),
		'```',
		'',
		'_It should satisfy `src/avatars/avatars.test.ts`: exactly 8×8, only `#`/`.` pixels, unique name._'
	].join('\n');
	const params = new URLSearchParams({ title, body });
	return `${REPO_URL}/issues/new?${params}`;
}
