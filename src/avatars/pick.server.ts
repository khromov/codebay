import { avatars } from './index.ts';
import type { AvatarArt } from './types.ts';

// Server-only: uses Bun.hash (a native, non-crypto hash) so we don't hand-roll one. crc32 returns a
// plain uint32 to bucket directly. Stable across processes/versions, so an id maps to the same sprite.
function bucket(id: string): number {
	return Bun.hash.crc32(id) % avatars.length;
}

/** A deterministic sprite for an id — the default before a unique one is chosen and persisted. */
export function pickAvatar(id: string): AvatarArt {
	return avatars[bucket(id)]!;
}

// Prefer the id's deterministic sprite; if it's taken, probe forward so only colliding instances
// deviate from what `pickAvatar` would give. Falls back to the hashed pick once the catalog is full.
export function pickUniqueAvatar(id: string, taken: Iterable<string>): AvatarArt {
	const used = new Set(taken);
	const base = bucket(id);
	for (let k = 0; k < avatars.length; k++) {
		const art = avatars[(base + k) % avatars.length]!;
		if (!used.has(art.name)) return art;
	}
	return avatars[base]!;
}
