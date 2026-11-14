import { getRequestContext, type Handle } from 'mochi-framework';
import { PROXY_PREFIX } from './proxy.server.ts';

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
			let ctx: ReturnType<typeof getRequestContext>;
			try {
				ctx = getRequestContext();
			} catch {
				return html;
			}
			// `data-theme` is only meaningful to Codebay's own stylesheet; injecting it into a
			// proxied code-server document would rewrite HTML that isn't ours, so leave it alone.
			if (ctx.url.pathname.startsWith(PROXY_PREFIX + '/')) return html;
			return injectThemeAttribute(html, ctx.cookies.get('theme'));
		}
	});
