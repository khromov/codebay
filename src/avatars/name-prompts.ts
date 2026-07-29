// Lives outside the editor component so the route can roll the hint server-side —
// rolling it during component init would re-roll it again at hydration.
export const NAME_PROMPTS = [
	'dragon',
	'unicorn',
	'cactus',
	'comet',
	'pretzel',
	'volcano',
	'narwhal',
	'waffle',
	'satellite',
	'pineapple',
	'kraken',
	'yeti',
	'moose',
	'lighthouse',
	'toaster',
	'hedgehog',
	'walrus',
	'pumpkin',
	'jellyfish',
	'tornado',
	'igloo',
	'boomerang'
];

export function pickNamePrompt(): string {
	return NAME_PROMPTS[Math.floor(Math.random() * NAME_PROMPTS.length)]!;
}
