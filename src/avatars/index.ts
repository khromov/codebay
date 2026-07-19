// Registry of all hand-crafted 8×8 avatar sprites + the deterministic picker
// that maps a dev-container id to one of them.
import type { AvatarArt } from './types.ts';

import anchor from './anchor.ts';
import bear from './bear.ts';
import bee from './bee.ts';
import bobMarley from './bob-marley.ts';
import car from './car.ts';
import carpathians from './carpathians.ts';
import cat from './cat.ts';
import catBody from './cat-body.ts';
import catSits from './cat-sits.ts';
import celticCross from './celtic-cross.ts';
import cherry from './cherry.ts';
import cotton from './cotton.ts';
import crab from './crab.ts';
import crown from './crown.ts';
import diamond from './diamond.ts';
import dog from './dog.ts';
import elephant from './elephant.ts';
import fish from './fish.ts';
import fleurDeLis from './fleur-de-lis.ts';
import flower from './flower.ts';
import fox from './fox.ts';
import frog from './frog.ts';
import ghost from './ghost.ts';
import giraffe from './giraffe.ts';
import glasses from './glasses.ts';
import heart from './heart.ts';
import invader from './invader.ts';
import kangaroo from './kangaroo.ts';
import key from './key.ts';
import lightning from './lightning.ts';
import mushroom from './mushroom.ts';
import octopus from './octopus.ts';
import owl from './owl.ts';
import penguin from './penguin.ts';
import planet from './planet.ts';
import rabbit from './rabbit.ts';
import rat from './rat.ts';
import robot from './robot.ts';
import rocket from './rocket.ts';
import sea from './sea.ts';
import skull from './skull.ts';
import snail from './snail.ts';
import snake from './snake.ts';
import snakegame from './snakegame.ts';
import star from './star.ts';
import svelte from './svelte.ts';
import target from './target.ts';
import tree from './tree.ts';
import ukraine from './ukraine.ts';
import whale from './whale.ts';
import wheat from './wheat.ts';
import yinyan from './yinyan.ts';

// Order is stable: a given id always resolves to the same index, so the artwork
// for a container never changes between renders or restarts.
export const avatars: AvatarArt[] = [
	anchor,
	bear,
	bee,
	bobMarley,
	car,
	carpathians,
	cat,
	catBody,
	catSits,
	celticCross,
	cherry,
	cotton,
	crab,
	crown,
	diamond,
	dog,
	elephant,
	fish,
	fleurDeLis,
	flower,
	fox,
	frog,
	ghost,
	giraffe,
	glasses,
	heart,
	invader,
	kangaroo,
	key,
	lightning,
	mushroom,
	octopus,
	owl,
	penguin,
	planet,
	rabbit,
	rat,
	robot,
	rocket,
	sea,
	skull,
	snail,
	snake,
	snakegame,
	star,
	svelte,
	target,
	tree,
	ukraine,
	whale,
	wheat,
	yinyan
];

// FNV-1a (32-bit) — a fast, well-distributed hash. Pure function of the input
// string, so the mapping is identical on every invocation, in any process.
function fnv1a(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

// Deterministically pick an artwork for a dev-container id. Duplicates across
// many instances are possible but rare — the hash spreads ids evenly across the
// whole catalog rather than clustering.
export function pickAvatar(id: string): AvatarArt {
	// `avatars` is non-empty and the modulo keeps the index in range.
	return avatars[fnv1a(id) % avatars.length]!;
}

export { decode } from './types.ts';
export type { AvatarArt } from './types.ts';
