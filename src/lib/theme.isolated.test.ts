import { describe, expect, test } from 'bun:test';
import { injectThemeAttribute } from './theme.server.ts';

// The end-to-end cookie -> SSR data-theme behavior (themeHandle wired into a
// live Mochi server) is covered in src/index.isolated.test.ts instead of here:
// Mochi.serve() is a process-wide singleton, so only one test file can spin
// up a server for the whole test run.
describe('injectThemeAttribute', () => {
	test('injects data-theme="dark" when the cookie says dark', () => {
		expect(injectThemeAttribute('<html lang="en">', 'dark')).toBe(
			'<html data-theme="dark" lang="en">'
		);
	});

	test('leaves the HTML untouched when the cookie is absent', () => {
		expect(injectThemeAttribute('<html lang="en">', undefined)).toBe('<html lang="en">');
	});

	test('leaves the HTML untouched for any non-"dark" cookie value', () => {
		expect(injectThemeAttribute('<html lang="en">', 'light')).toBe('<html lang="en">');
		expect(injectThemeAttribute('<html lang="en">', 'bogus')).toBe('<html lang="en">');
	});
});
