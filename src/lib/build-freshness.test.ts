import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { staleBuildInputs, warnIfBuildStale } from './build-freshness.server.ts';

const BUILT_AT = new Date('2026-09-05T05:36:00Z');
const EARLIER = new Date(BUILT_AT.getTime() - 60_000);
const LATER = new Date(BUILT_AT.getTime() + 60_000);

const SOURCES = [
	'src/pages/App.svelte',
	'src/components/AppShell.svelte',
	'src/components/AgentLogBox.svelte',
	'src/api.ts',
	'node_modules/dep/index.js'
];

// The shape Mochi 0.9's manifest v2 actually has: pages under `components`, islands as
// `hydratables`, and every client bundle input under `stats`.
const MANIFEST = {
	version: 2,
	components: {
		'src/pages/App.svelte': {
			ssrModule: 'svelte-compile/App.server.js',
			hydratables: [{ name: 'AppShell_x', resolvedPath: 'src/components/AppShell.svelte' }]
		},
		'$mochi/templates/DefaultError.svelte': { ssrModule: 'x', hydratables: [] }
	},
	stats: {
		outputs: [
			{
				name: 'a.js',
				inputs: [
					{ path: 'src/components/AgentLogBox.svelte', size: 1 },
					{ path: 'src/api.ts', size: 1 },
					{ path: 'src/components/Deleted.svelte', size: 1 },
					{ path: 'node_modules/dep/index.js', size: 1 },
					{ path: 'mochi-env:mochi-framework', size: 1 }
				]
			}
		]
	}
};

const roots: string[] = [];

function touch(root: string, rel: string, at: Date): void {
	utimesSync(join(root, rel), at, at);
}

/** A checkout-shaped tree where every source predates the build. */
function scaffold(): string {
	const root = mkdtempSync(join(tmpdir(), 'codebay-build-freshness-'));
	roots.push(root);
	for (const rel of SOURCES) {
		mkdirSync(join(root, dirname(rel)), { recursive: true });
		writeFileSync(join(root, rel), '');
		touch(root, rel, EARLIER);
	}
	mkdirSync(join(root, '.mochi'));
	writeFileSync(join(root, '.mochi', 'manifest.json'), JSON.stringify(MANIFEST));
	touch(root, '.mochi/manifest.json', BUILT_AT);
	return root;
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('staleBuildInputs', () => {
	test('is empty when every input predates the build', () => {
		expect(staleBuildInputs(scaffold())).toEqual([]);
	});

	test('names pages, islands, and bundle inputs edited after the build, sorted', () => {
		const root = scaffold();
		touch(root, 'src/components/AgentLogBox.svelte', LATER);
		touch(root, 'src/pages/App.svelte', LATER);
		touch(root, 'src/components/AppShell.svelte', LATER);
		touch(root, 'src/api.ts', LATER);
		expect(staleBuildInputs(root)).toEqual([
			'src/api.ts',
			'src/components/AgentLogBox.svelte',
			'src/components/AppShell.svelte',
			'src/pages/App.svelte'
		]);
	});

	test('ignores dependencies, virtual modules, and inputs no longer on disk', () => {
		const root = scaffold();
		touch(root, 'node_modules/dep/index.js', LATER);
		expect(staleBuildInputs(root)).toEqual([]);
	});

	test('is empty without a manifest, which is Mochi’s own error to report', () => {
		const root = scaffold();
		rmSync(join(root, '.mochi'), { recursive: true });
		expect(staleBuildInputs(root)).toEqual([]);
	});
});

describe('warnIfBuildStale', () => {
	const savedMode = process.env.MODE;
	let warn: ReturnType<typeof spyOn>;

	beforeEach(() => {
		delete process.env.MODE;
		warn = spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		if (savedMode === undefined) delete process.env.MODE;
		else process.env.MODE = savedMode;
	});

	test('warns, naming the file, when a checkout’s build is stale', () => {
		const root = scaffold();
		mkdirSync(join(root, '.git'));
		touch(root, 'src/components/AgentLogBox.svelte', LATER);
		warnIfBuildStale(root);
		expect(warn).toHaveBeenCalledTimes(1);
		const message = String(warn.mock.calls[0]![0]);
		expect(message).toContain('src/components/AgentLogBox.svelte');
		expect(message).toContain('bun run build');
	});

	test('stays quiet when the build is current', () => {
		const root = scaffold();
		mkdirSync(join(root, '.git'));
		warnIfBuildStale(root);
		expect(warn).not.toHaveBeenCalled();
	});

	test('stays quiet outside a checkout, where mtimes mean install time, not edits', () => {
		const root = scaffold();
		touch(root, 'src/components/AgentLogBox.svelte', LATER);
		warnIfBuildStale(root);
		expect(warn).not.toHaveBeenCalled();
	});

	test('stays quiet in development, where the manifest is never read', () => {
		const root = scaffold();
		mkdirSync(join(root, '.git'));
		touch(root, 'src/components/AgentLogBox.svelte', LATER);
		process.env.MODE = 'development';
		warnIfBuildStale(root);
		expect(warn).not.toHaveBeenCalled();
	});
});
