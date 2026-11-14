/**
 * Importable only from the Svelte build graph — `cookies` resolves through Mochi's
 * isomorphic virtual module. Server entry files use `getRequestContext().cookies` instead.
 */
import { cookies } from 'mochi-framework';
import type { Theme } from './types.ts';

export type { Theme };

const THEME_KEY = 'theme';

export function getTheme(): Theme {
	const value = cookies.get(THEME_KEY);
	return value === 'dark' || value === 'light' ? value : 'auto';
}

export function setTheme(theme: Theme): void {
	cookies.set(THEME_KEY, theme, { expires: 400, path: '/' });
}

/** Auto removes the attribute entirely, letting `light-dark()` follow the browser preference. */
export function applyTheme(theme: Theme): void {
	if (theme === 'auto') delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
}

/** A choice pushed over the stream: persist it here too, so this client's next SSR paint matches. */
export function syncTheme(theme: Theme): void {
	setTheme(theme);
	applyTheme(theme);
}
