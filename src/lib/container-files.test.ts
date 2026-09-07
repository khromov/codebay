import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	appendLinesScript,
	deepMerge,
	linesPresentScript,
	parseJsonRead,
	parseReadScriptOutput,
	readFileScript,
	shellSingleQuote,
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

	test('drops a __proto__ key instead of polluting Object.prototype', () => {
		const merged = deepMerge({}, JSON.parse('{"__proto__":{"polluted":true},"a":1}'));
		expect(merged).toEqual({ a: 1 });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
});

describe('parseJsonRead', () => {
	test('absent or empty content starts fresh (ok, null)', () => {
		expect(parseJsonRead(null, 'settings.json')).toEqual({ ok: true, data: null });
		expect(parseJsonRead('', 'settings.json')).toEqual({ ok: true, data: null });
	});

	test('parses a JSON object', () => {
		expect(parseJsonRead('{"model":"opus"}', 'settings.json')).toEqual({
			ok: true,
			data: { model: 'opus' }
		});
	});

	test('non-empty unparseable content errors so edits refuse to overwrite it', () => {
		const res = parseJsonRead('motd noise{"model":"opus"}', 'settings.json');
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('settings.json');
	});

	test('valid JSON that is not an object errors too', () => {
		expect(parseJsonRead('[1,2]', 'f').ok).toBe(false);
		expect(parseJsonRead('"str"', 'f').ok).toBe(false);
	});
});

describe('shellSingleQuote', () => {
	test('values survive sourcing verbatim, including quotes and expansions', () => {
		const value = `sp ace;$(echo pwned) 'quoted' $HOME`;
		const out = Bun.spawnSync(['bash', '-c', `V=${shellSingleQuote(value)}; printf '%s' "$V"`]);
		expect(out.exitCode).toBe(0);
		expect(out.stdout.toString()).toBe(value);
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

/** Runs a read script through bash and the host-side parser, as `readContainerFileResult` does. */
function runRead(script: string, name: string) {
	const read = Bun.spawnSync(['bash', '-c', script]);
	expect(read.exitCode).toBe(0);
	return parseReadScriptOutput(read.stdout.toString().trim(), name);
}

describe('writeFileScript / readFileScript', () => {
	test('writes stdin to the file, then reads it back verbatim', () => {
		runInTmp((dir) => {
			const file = { dir, name: 'settings.json' };
			Bun.spawnSync(['bash', '-c', writeFileScript(file)], {
				env: { ...process.env, CODEBAY_STDIN: '{"model":"opus"}' }
			});
			expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{"model":"opus"}');

			expect(runRead(readFileScript(file), 'settings.json')).toEqual({
				ok: true,
				content: '{"model":"opus"}'
			});
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

	test('a write that cannot create its parent dir exits non-zero', () => {
		runInTmp((dir) => {
			writeFileSync(join(dir, 'blocker'), '');
			const res = Bun.spawnSync(
				['bash', '-c', writeFileScript({ dir: `${dir}/blocker/sub`, name: 'f' })],
				{
					env: { ...process.env, CODEBAY_STDIN: 'x' }
				}
			);
			expect(res.exitCode).not.toBe(0);
		});
	});

	test('reading an absent file reports absent, not an error', () => {
		runInTmp((dir) => {
			expect(runRead(readFileScript({ dir, name: 'nope' }), 'nope')).toEqual({
				ok: true,
				content: null
			});
		});
	});

	test('login-shell profile noise before the marker does not corrupt the read', () => {
		runInTmp((dir) => {
			const file = { dir, name: 'settings.json' };
			writeFileSync(join(dir, 'settings.json'), '{"model":"opus"}');
			const noisy = `echo 'Welcome to the container!'; ${readFileScript(file)}`;
			expect(runRead(noisy, 'settings.json')).toEqual({ ok: true, content: '{"model":"opus"}' });
		});
	});

	// Windows has no mode bits for chmod to clear, so the file stays readable and the probe passes.
	test.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
		'an unreadable file errors instead of reading as absent',
		() => {
			runInTmp((dir) => {
				writeFileSync(join(dir, 'secret.json'), '{"keep":true}');
				chmodSync(join(dir, 'secret.json'), 0o000);
				const res = runRead(readFileScript({ dir, name: 'secret.json' }), 'secret.json');
				expect(res.ok).toBe(false);
				if (!res.ok) expect(res.error).toContain('unreadable');
			});
		}
	);
});

describe('parseReadScriptOutput', () => {
	test('output with no marker errors so an edit refuses to proceed', () => {
		const res = parseReadScriptOutput('profile noise only', 'settings.json');
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('settings.json');
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

describe('linesPresentScript', () => {
	test('1 when every line is in at least one file, 0 when any is missing everywhere', () => {
		runInTmp((dir) => {
			const files = [
				{ dir, name: '.bashrc' },
				{ dir, name: '.zshrc' }
			];
			writeFileSync(join(dir, '.bashrc'), 'line-a\n');
			writeFileSync(join(dir, '.zshrc'), 'line-b\n');
			const script = linesPresentScript(files);
			const split = Bun.spawnSync(['bash', '-c', script, 'lines-present', 'line-a', 'line-b']);
			expect(split.stdout.toString().trim()).toBe('1');
			const missing = Bun.spawnSync(['bash', '-c', script, 'lines-present', 'line-a', 'line-c']);
			expect(missing.stdout.toString().trim()).toBe('0');
		});
	});
});
