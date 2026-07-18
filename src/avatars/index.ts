// Registry of all hand-crafted 8×8 avatar sprites + the deterministic picker
// that maps a dev-container id to one of them.
import type { AvatarArt } from './types.ts';

import anchor from './anchor.ts';
import bear from './bear.ts';
import bee from './bee.ts';
import bobMarley from './bob-marley.ts';
import cat from './cat.ts';
import cherry from './cherry.ts';
import crab from './crab.ts';
import crown from './crown.ts';
import diamond from './diamond.ts';
import dog from './dog.ts';
import fish from './fish.ts';
import flower from './flower.ts';
import fox from './fox.ts';
import frog from './frog.ts';
import ghost from './ghost.ts';
import heart from './heart.ts';
import invader from './invader.ts';
import key from './key.ts';
import lightning from './lightning.ts';
import mushroom from './mushroom.ts';
import octopus from './octopus.ts';
import owl from './owl.ts';
import penguin from './penguin.ts';
import planet from './planet.ts';
import rabbit from './rabbit.ts';
import robot from './robot.ts';
import rocket from './rocket.ts';
import skull from './skull.ts';
import snail from './snail.ts';
import star from './star.ts';
import target from './target.ts';
import tree from './tree.ts';
import whale from './whale.ts';

// Order is stable: a given id always resolves to the same index, so the artwork
// for a container never changes between renders or restarts.
export const avatars: AvatarArt[] = [
	anchor,
	bear,
	bee,
	bobMarley,
	cat,
	cherry,
	crab,
	crown,
	diamond,
	dog,
	fish,
	flower,
	fox,
	frog,
	ghost,
	heart,
	invader,
	key,
	lightning,
	mushroom,
	octopus,
	owl,
	penguin,
	planet,
	rabbit,
	robot,
	rocket,
	skull,
	snail,
	star,
	target,
	tree,
	whale
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
