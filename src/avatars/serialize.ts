// Turns an avatar-editor drawing into the two things a contribution needs:
// module source and a pre-filled issue URL.
import { type AvatarArt, ROWS, COLS, ON } from './types.ts';

export const REPO_URL = 'https://github.com/khromov/codebay';

// The name doubles as a filename and a catalog key, hence the aggressive squash.
export function normalizeName(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

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

// Byte-identical to the hand-written sprites (tabs, single quotes, trailing newline),
// so a maintainer can drop it in and prettier won't touch it.
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

// The art is ~64 chars, far below any URL length limit.
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
