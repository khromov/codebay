import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { themeHandle } from './lib/theme.server.ts';

const routes = {
	'/': Mochi.page('./src/__fixtures__/HelloWorld.svelte')
};

// Mochi.serve() is a process-wide singleton (see mochiConfig.ts), so every
// isolated test that needs a live server shares this one instance — including
// the themeHandle checks below, which is why `handle` is wired in here.
describe('minimal app', () => {
	let server: Server<undefined>;
	let outDir: string;
	let base: string;

	beforeAll(async () => {
		outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-minimal-test-'));
		server = await Mochi.serve({
			port: 0,
			development: false,
			logger: { enabled: false },
			outDir,
			htmlShell: './src/shell.html',
			handle: themeHandle,
			routes
		});
		base = `http://localhost:${server.port}`;
	});

	afterAll(() => {
		server.stop(true);
		rmSync(outDir, { recursive: true, force: true });
	});

	test('GET / renders Hello world', async () => {
		const res = await fetch(base);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Hello Mochi!');
	});

	test('GET / renders light theme (no data-theme attribute) with no theme cookie', async () => {
		const res = await fetch(base);
		expect(await res.text()).not.toContain('<html data-theme');
	});

	test('GET / renders data-theme="dark" when the theme cookie is dark', async () => {
		const res = await fetch(base, { headers: { Cookie: 'theme=dark' } });
		expect(await res.text()).toContain('<html data-theme="dark"');
	});
});
