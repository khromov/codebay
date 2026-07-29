// SSR-safe: every function no-ops when localStorage is absent.

const SOUND_KEY = 'codebay.sound';

/** Defaults to on — only an explicit 'off' disables it. */
export function soundEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(SOUND_KEY) !== 'off';
}

export function setSoundEnabled(on: boolean): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
}
