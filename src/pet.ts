/**
 * Importable only from the Svelte build graph — `cookies` resolves through Mochi's
 * isomorphic virtual module, so SSR already knows the pet and the logo never swaps
 * on hydration. Server entry files use `getRequestContext().cookies` instead.
 */
import { cookies } from 'mochi-framework';
import { avatars, findAvatar, type AvatarArt } from './avatars/index.ts';

const PET_KEY = 'pet';

/** Undefined means the default box logo; a name that left the catalog reads the same way. */
export function getPet(): AvatarArt | undefined {
	return findAvatar(cookies.get(PET_KEY));
}

export function setPet(name: string): void {
	cookies.set(PET_KEY, name, { expires: 400, path: '/' });
}

export function clearPet(): void {
	cookies.delete(PET_KEY, { path: '/' });
}

/** Flipping the toggle on lands on a random sprite, so there's always a pet to adjust from. */
export function randomPet(): AvatarArt {
	return avatars[Math.floor(Math.random() * avatars.length)]!;
}
