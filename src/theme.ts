/**
 * Cookie-backed dark/light theme preference. IMPORTANT: only import this from
 * `.svelte` files (or plain `.ts` modules they import) — `cookies` here resolves
 * through Mochi's isomorphic virtual module, which only exists in the Svelte
 * build graph. Server entry files (index.ts, *.server.ts) must instead use
 * `getRequestContext().cookies` — see src/lib/theme.server.ts.
 */
import { cookies } from 'mochi-framework';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'theme';

export function getTheme(): Theme {
	return cookies.get(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
	cookies.set(THEME_KEY, theme, { expires: 400, path: '/' });
}
