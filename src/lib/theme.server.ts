import { getRequestContext, type Handle } from 'mochi-framework';

/** Injects `data-theme="dark"` into the shell's `<html>` tag when the theme cookie says so. Light is the implicit default — an absent/unrecognized cookie leaves the HTML untouched. */
export function injectThemeAttribute(html: string, cookieValue: string | undefined): string {
	if (cookieValue !== 'dark') return html;
	return html.replace('<html', '<html data-theme="dark"');
}

/**
 * Rewrites the SSR'd `<html>` tag to carry the visitor's theme cookie before the
 * response is sent, so the first paint already renders in the right theme — no
 * client-side flash-of-wrong-theme on reload. Composed alongside `basicAuth` via
 * `sequence()` in src/index.ts rather than folded into it, to keep auth/CSRF
 * logic untouched.
 */
export const themeHandle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPage: ({ html }) => {
			// transformPage also fires for HTML responses (e.g. 404s) produced by
			// Mochi's fetch-fallback path (static assets, proxy passthrough), which
			// runs outside the page/api dispatchers' requestContext.run() — so no
			// request context, and thus no theme cookie, is available there.
			let cookieValue: string | undefined;
			try {
				cookieValue = getRequestContext().cookies.get('theme');
			} catch {
				return html;
			}
			return injectThemeAttribute(html, cookieValue);
		}
	});
