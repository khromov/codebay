import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstanceRow } from './db.server.ts';
import { execInContainer } from './exec.server.ts';
import {
	hostFileNameFor,
	parseFetchBlocks,
	parseManifest,
	planFetch,
	runCapturePass
} from './log-capture.server.ts';

describe('parseManifest', () => {
	test('skips login-shell noise before the marker and parses path/size lines', () => {
		const stdout = [
			'profile banner',
			'__CODEBAY_MANIFEST__',
			'/h/.claude/history.jsonl\t42',
			'/h/.claude/projects/enc/s1.jsonl\t100'
		].join('\n');
		expect(parseManifest(stdout)).toEqual([
			{ path: '/h/.claude/history.jsonl', size: 42 },
			{ path: '/h/.claude/projects/enc/s1.jsonl', size: 100 }
		]);
	});

	test('returns nothing when the marker is absent', () => {
		expect(parseManifest('some unrelated output')).toEqual([]);
	});
});

describe('hostFileNameFor', () => {
	test('names history and transcripts with the instance id embedded', () => {
		expect(hostFileNameFor('abc', '/home/node/.claude/history.jsonl')).toBe('history-abc.jsonl');
		expect(hostFileNameFor('abc', '/home/node/.claude/projects/enc/9f2.jsonl')).toBe(
			'transcript-abc-9f2.jsonl'
		);
	});
});

describe('planFetch', () => {
	const manifest = [
		{ path: '/c/.claude/history.jsonl', size: 50 },
		{ path: '/c/.claude/projects/e/s.jsonl', size: 200 }
	];

	test('appends new bytes from the current host offset', () => {
		const jobs = planFetch('id', manifest, (name) => (name === 'history-id.jsonl' ? 20 : 200));
		// history grew (append from byte 21); transcript unchanged (skipped).
		expect(jobs).toEqual([
			{
				path: '/c/.claude/history.jsonl',
				hostFileName: 'history-id.jsonl',
				startByte: 21,
				mode: 'append'
			}
		]);
	});

	test('re-pulls a file that shrank below the host mirror', () => {
		const jobs = planFetch('id', manifest, (name) => (name === 'transcript-id-s.jsonl' ? 999 : 50));
		expect(jobs).toContainEqual({
			path: '/c/.claude/projects/e/s.jsonl',
			hostFileName: 'transcript-id-s.jsonl',
			startByte: 1,
			mode: 'rewrite'
		});
	});
});

describe('parseFetchBlocks', () => {
	test('splits framed blocks and strips base64 line wrapping', () => {
		const b64 = Buffer.from('hello world').toString('base64');
		const wrapped = `${b64.slice(0, 4)}\n${b64.slice(4)}`; // simulate GNU 76-col wrapping
		const stdout = [
			'__CODEBAY_FETCH__',
			`__CODEBAY_FILE__\t/c/a.jsonl`,
			wrapped,
			'__CODEBAY_END__'
		].join('\n');
		const blocks = parseFetchBlocks(stdout);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.path).toBe('/c/a.jsonl');
		expect(Buffer.from(blocks[0]?.base64 ?? '', 'base64').toString()).toBe('hello world');
	});
});

// --- Full-pass orchestration against a fake exec + a temp logs dir ---

function row(overrides: Partial<InstanceRow> = {}): InstanceRow {
	return {
		id: 'inst1',
		name: 'demo',
		source_path: '/src/demo',
		workspace_path: '/data/instances/inst1/demo',
		host_port: 8001,
		container_id: 'container1',
		remote_workspace_folder: null,
		status: 'running',
		error: null,
		created_at: 111,
		bridge_token: 'tok',
		remote_user: 'node',
		image_source: null,
		mode: 'ide',
		terminal_split: 0,
		...overrides
	} as InstanceRow;
}

/** A fake `execInContainer` backed by an in-memory container filesystem. */
function fakeExec(files: Map<string, Buffer>): typeof execInContainer {
	return (async (_target, opts) => {
		if (opts.script.includes('__CODEBAY_MANIFEST__')) {
			const lines = ['boot noise', '__CODEBAY_MANIFEST__'];
			for (const [path, buf] of files) lines.push(`${path}\t${buf.length}`);
			return { ok: true, stdout: lines.join('\n') };
		}
		// Fetch: opts.args = ['fetch', path1, start1, path2, start2, ...]
		const args = opts.args ?? [];
		const out = ['__CODEBAY_FETCH__'];
		for (let i = 1; i + 1 < args.length; i += 2) {
			const path = args[i]!;
			const start = Number(args[i + 1]);
			const buf = files.get(path) ?? Buffer.alloc(0);
			const slice = buf.subarray(start - 1); // tail -c +N is 1-indexed
			out.push(`__CODEBAY_FILE__\t${path}`, slice.toString('base64'), '__CODEBAY_END__');
		}
		// Mirror the real helper trimming trailing whitespace off captured stdout.
		return { ok: true, stdout: out.join('\n').trim() };
	}) as typeof execInContainer;
}

describe('runCapturePass', () => {
	let logsDir: string;
	afterEach(() => {
		if (logsDir) rmSync(logsDir, { recursive: true, force: true });
	});

	const HIST = '/home/node/.claude/history.jsonl';
	const SESS = '/home/node/.claude/projects/enc/s1.jsonl';

	test('mirrors files, appends incrementally, rewrites on shrink, and indexes', async () => {
		logsDir = mkdtempSync(join(tmpdir(), 'codebay-logs-'));
		const files = new Map<string, Buffer>([
			[HIST, Buffer.from('h1\n')],
			[SESS, Buffer.from('line1\nline2\n')]
		]);
		const deps = { exec: fakeExec(files), logsDir };
		const histPath = join(logsDir, 'history-inst1.jsonl');
		const sessPath = join(logsDir, 'transcript-inst1-s1.jsonl');

		// First pass: full copy of both files.
		await runCapturePass(row(), deps);
		expect(readFileSync(histPath, 'utf8')).toBe('h1\n');
		expect(readFileSync(sessPath, 'utf8')).toBe('line1\nline2\n');

		// Container transcript grows: only the delta is appended.
		files.set(SESS, Buffer.from('line1\nline2\nline3\n'));
		await runCapturePass(row(), deps);
		expect(readFileSync(sessPath, 'utf8')).toBe('line1\nline2\nline3\n');

		// Container transcript shrinks (session reset): the whole file is re-pulled.
		files.set(SESS, Buffer.from('fresh\n'));
		await runCapturePass(row(), deps);
		expect(readFileSync(sessPath, 'utf8')).toBe('fresh\n');

		// Index maps the opaque filenames back to the instance.
		const index = JSON.parse(readFileSync(join(logsDir, 'index.json'), 'utf8'));
		expect(index.inst1.name).toBe('demo');
		expect(index.inst1.source_path).toBe('/src/demo');
	});

	test('is a no-op that still indexes when there are no Claude files', async () => {
		logsDir = mkdtempSync(join(tmpdir(), 'codebay-logs-'));
		await runCapturePass(row(), { exec: fakeExec(new Map()), logsDir });
		const index = JSON.parse(readFileSync(join(logsDir, 'index.json'), 'utf8'));
		expect(index.inst1).toBeDefined();
	});

	test('does nothing without a container id', async () => {
		logsDir = mkdtempSync(join(tmpdir(), 'codebay-logs-'));
		let called = false;
		const exec = (async () => {
			called = true;
			return { ok: true, stdout: '' };
		}) as typeof execInContainer;
		await runCapturePass(row({ container_id: null }), { exec, logsDir });
		expect(called).toBe(false);
	});
});
