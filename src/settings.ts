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

const TAB_SHORTCUTS_KEY = 'codebay.tabShortcuts';

/** Defaults to on — only an explicit 'off' disables the Alt+1-9 tab jumps. */
export function tabShortcutsEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(TAB_SHORTCUTS_KEY) !== 'off';
}

export function setTabShortcutsEnabled(on: boolean): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(TAB_SHORTCUTS_KEY, on ? 'on' : 'off');
}
