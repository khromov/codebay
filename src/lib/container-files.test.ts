import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	appendLinesScript,
	deepMerge,
	readFileScript,
	writeFileScript
} from './container-files.server.ts';

describe('deepMerge (jq `.[0] * .[1]` semantics)', () => {
	test('adds new keys and overrides scalars', () => {
		expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
	});

	test('recurses into nested plain objects', () => {
		expect(
			deepMerge({ attribution: { commit: 'x', pr: 'y' } }, { attribution: { pr: '' } })
		).toEqual({ attribution: { commit: 'x', pr: '' } });
	});

	test('replaces arrays wholesale rather than concatenating', () => {
		expect(deepMerge({ xs: [1, 2, 3] }, { xs: [9] })).toEqual({ xs: [9] });
	});

	test('a scalar patch replaces an object base and vice versa', () => {
		expect(deepMerge({ v: { nested: true } }, { v: 'scalar' })).toEqual({ v: 'scalar' });
		expect(deepMerge({ v: 'scalar' }, { v: { nested: true } })).toEqual({ v: { nested: true } });
	});

	test('does not mutate the base object', () => {
		const base = { a: { b: 1 } };
		deepMerge(base, { a: { c: 2 } });
		expect(base).toEqual({ a: { b: 1 } });
	});
});

/** Run a builder's bash against a temp dir, exactly as `execInContainer` would in a container. */
function runInTmp<T>(fn: (dir: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-files-'));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('writeFileScript / readFileScript', () => {
	test('writes stdin to the file, then reads it back verbatim', () => {
		runInTmp((dir) => {
			const file = { dir, name: 'settings.json' };
			Bun.spawnSync(['bash', '-c', writeFileScript(file)], {
				env: { ...process.env, CODEBAY_STDIN: '{"model":"opus"}' }
			});
			expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{"model":"opus"}');

			const read = Bun.spawnSync(['bash', '-c', readFileScript(file)]);
			expect(read.stdout.toString().trim()).toBe('{"model":"opus"}');
		});
	});

	test('creates missing parent directories on write', () => {
		runInTmp((dir) => {
			const file = { dir: `${dir}/nested/deep`, name: 'f.txt' };
			Bun.spawnSync(['bash', '-c', writeFileScript(file)], {
				env: { ...process.env, CODEBAY_STDIN: 'hi' }
			});
			expect(readFileSync(join(dir, 'nested/deep/f.txt'), 'utf8')).toBe('hi');
		});
	});

	test('reading an absent file yields empty output and exit 0', () => {
		runInTmp((dir) => {
			const read = Bun.spawnSync(['bash', '-c', readFileScript({ dir, name: 'nope' })]);
			expect(read.exitCode).toBe(0);
			expect(read.stdout.toString()).toBe('');
		});
	});
});

describe('appendLinesScript', () => {
	test('appends each line once and never duplicates on re-apply', () => {
		runInTmp((dir) => {
			const script = appendLinesScript([{ dir, name: 'rc' }]);
			// $0 is a throwaway label; the lines themselves arrive as $@ — matching execInContainer args.
			Bun.spawnSync(['bash', '-c', script, 'append-lines', 'line-a', 'line-b']);
			Bun.spawnSync(['bash', '-c', script, 'append-lines', 'line-a', 'line-c']);
			const content = readFileSync(join(dir, 'rc'), 'utf8');
			expect(content.match(/^line-a$/gm)?.length).toBe(1);
			expect(content).toContain('line-b');
			expect(content).toContain('line-c');
		});
	});

	test('appends to every listed file', () => {
		runInTmp((dir) => {
			const files = [
				{ dir, name: '.bashrc' },
				{ dir, name: '.zshrc' }
			];
			writeFileSync(join(dir, '.bashrc'), '');
			writeFileSync(join(dir, '.zshrc'), '');
			Bun.spawnSync(['bash', '-c', appendLinesScript(files), 'append-lines', 'shared']);
			expect(readFileSync(join(dir, '.bashrc'), 'utf8')).toContain('shared');
			expect(readFileSync(join(dir, '.zshrc'), 'utf8')).toContain('shared');
		});
	});
});
