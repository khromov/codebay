import { getRequestContext, type Handle } from 'mochi-framework';

/** Anything but an explicit choice is left untouched, so the CSS falls through to `prefers-color-scheme`. */
export function injectThemeAttribute(html: string, cookieValue: string | undefined): string {
	if (cookieValue !== 'dark' && cookieValue !== 'light') return html;
	return html.replace('<html', `<html data-theme="${cookieValue}"`);
}

/** Rewrites the tag server-side so the first paint has no flash of the wrong theme. */
export const themeHandle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPage: ({ html }) => {
			// Mochi's fetch-fallback path also lands here, and it runs outside requestContext.
			let cookieValue: string | undefined;
			try {
				cookieValue = getRequestContext().cookies.get('theme');
			} catch {
				return html;
			}
			return injectThemeAttribute(html, cookieValue);
		}
	});
