import { soundEnabled } from './settings.ts';

/** Chime name → URL of its pre-rendered WAV (served from `public/sounds/`).
 * Generate/refresh these files with `bun run gen:chimes`. */
const SOUNDS = {
	done: '/sounds/done.wav', // brighter ascending pair
	waiting: '/sounds/waiting.wav' // lower, more insistent
} as const;

type Chime = keyof typeof SOUNDS;

/** Lazily-created <audio> elements, one per chime, reused across plays. */
const elements: Partial<Record<Chime, HTMLAudioElement>> = {};
let unlocked = false;

function element(name: Chime): HTMLAudioElement | null {
	if (typeof window === 'undefined') return null;
	let el = elements[name];
	if (!el) {
		el = new Audio(SOUNDS[name]);
		el.preload = 'auto';
		elements[name] = el;
	}
	return el;
}

/** Prime each chime so later programmatic playback is allowed. Call from a
 * user-gesture handler — browsers block audio until the page has been
 * interacted with. A silent play/pause inside the gesture satisfies that. */
export function unlockAudio(): void {
	if (unlocked || typeof window === 'undefined') return;
	unlocked = true;
	for (const name of Object.keys(SOUNDS) as Chime[]) {
		const el = element(name);
		if (!el) continue;
		const { volume } = el;
		el.volume = 0;
		void el
			.play()
			.then(() => {
				el.pause();
				el.currentTime = 0;
				el.volume = volume;
			})
			.catch(() => {
				el.volume = volume;
			});
	}
}

/** Play a short attention chime, unless the user has muted sound. */
export function playChime(state: Chime): void {
	if (!soundEnabled()) return;
	const el = element(state);
	if (!el) return;
	el.currentTime = 0;
	// Rejects if the page hasn't been interacted with yet; nothing to do but ignore.
	void el.play().catch(() => {});
}
