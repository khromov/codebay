// Turns an avatar-editor drawing into the two things a contribution needs:
// module source and a pre-filled issue URL.
import { type AvatarArt, ROWS, COLS, ON, GRAY } from './types.ts';

export const REPO_URL = 'https://github.com/khromov/codebay';

// A brand-new sprite vs. a hand-redraw of an existing (AI-generated) one — the two
// produce differently-shaped issues so the contribution skill can tell them apart.
export type ContributionMode = 'create' | 'edit';

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
			const cell = cells[r * COLS + c];
			row += cell === ON ? '#' : cell === GRAY ? '+' : '.';
		}
		rows.push(row);
	}
	return rows;
}

// Byte-identical to the hand-written sprites (tabs, single quotes, trailing newline),
// so a maintainer can drop it in and prettier won't touch it. It never emits `robot`,
// so a redraw of an AI sprite lands as a plain hand-drawn module — human-made by construction.
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
export function toIssueUrl(art: AvatarArt, mode: ContributionMode = 'create'): string {
	const body = mode === 'edit' ? editIssueBody(art) : createIssueBody(art);
	const title = mode === 'edit' ? `Avatar edit: ${art.name}` : `Avatar contribution: ${art.name}`;
	const params = new URLSearchParams({ title, body });
	return `${REPO_URL}/issues/new?${params}`;
}

function createIssueBody(art: AvatarArt): string {
	return [
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
		'_It should satisfy `src/avatars/avatars.test.ts`: exactly 8×8, only `#`/`+`/`.` pixels, unique name._'
	].join('\n');
}

// A redraw replaces an existing AI-generated sprite in place; the module carries no
// `robot` flag, so landing it promotes the sprite from robot-drawn to hand-drawn.
function editIssueBody(art: AvatarArt): string {
	return [
		`Hi! I redrew the existing \`${art.name}\` sprite by hand in the editor easter egg — it started as an AI-generated placeholder and this replaces it.`,
		'',
		'```',
		...art.pixels,
		'```',
		'',
		`Ready-to-paste replacement for \`src/avatars/${art.name}.ts\` (the \`robot\` flag is intentionally dropped — it's hand-drawn now):`,
		'',
		'```ts',
		toModuleSource(art).trimEnd(),
		'```',
		'',
		'_It should satisfy `src/avatars/avatars.test.ts`: exactly 8×8, only `#`/`+`/`.` pixels._'
	].join('\n');
}
