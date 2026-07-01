/** Client-side UI preferences, persisted in localStorage (SSR-safe no-ops on the server). */

const SOUND_KEY = 'dcm.sound';

/** Whether the attention chime is enabled. Defaults to on unless explicitly turned off. */
export function soundEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(SOUND_KEY) !== 'off';
}

export function setSoundEnabled(on: boolean): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
}
