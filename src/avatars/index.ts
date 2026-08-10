import type { AvatarArt } from './types.ts';

import anchor from './anchor.ts';
import antHead from './ant-head.ts';
import apple from './apple.ts';
import bear from './bear.ts';
import bee from './bee.ts';
import bobMarley from './bob-marley.ts';
import bodybuilder from './bodybuilder.ts';
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
import horse from './horse.ts';
import invader from './invader.ts';
import kangaroo from './kangaroo.ts';
import key from './key.ts';
import lightning from './lightning.ts';
import mushroom from './mushroom.ts';
import octopus from './octopus.ts';
import owl from './owl.ts';
import penguin from './penguin.ts';
import planet from './planet.ts';
import prayingMantis from './praying-mantis.ts';
import rabbit from './rabbit.ts';
import rat from './rat.ts';
import robot from './robot.ts';
import rocket from './rocket.ts';
import sea from './sea.ts';
import skull from './skull.ts';
import snail from './snail.ts';
import snake from './snake.ts';
import snakegame from './snakegame.ts';
import snowflake from './snowflake.ts';
import star from './star.ts';
import strawberry from './strawberry.ts';
import svelte from './svelte.ts';
import target from './target.ts';
import tree from './tree.ts';
import ukraine from './ukraine.ts';
import vangoghAlmondBlossoms from './vangogh-almond-blossoms.ts';
import wasp from './wasp.ts';
import whale from './whale.ts';
import wheat from './wheat.ts';
import windmill from './windmill.ts';
import yinyan from './yinyan.ts';

// Order must stay stable, or every container's artwork changes on the next restart.
export const avatars: AvatarArt[] = [
	anchor,
	antHead,
	apple,
	bear,
	bee,
	bobMarley,
	bodybuilder,
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
	horse,
	invader,
	kangaroo,
	key,
	lightning,
	mushroom,
	octopus,
	owl,
	penguin,
	planet,
	prayingMantis,
	rabbit,
	rat,
	robot,
	rocket,
	sea,
	skull,
	snail,
	snake,
	snakegame,
	snowflake,
	star,
	strawberry,
	svelte,
	target,
	tree,
	ukraine,
	vangoghAlmondBlossoms,
	wasp,
	whale,
	wheat,
	windmill,
	yinyan
];

/** Lookup by name; the server (`pick.server.ts`) resolves an instance's stored sprite name to its art. */
export function findAvatar(name: string | undefined): AvatarArt | undefined {
	return name ? avatars.find((a) => a.name === name) : undefined;
}

export { decode } from './types.ts';
export type { AvatarArt } from './types.ts';
