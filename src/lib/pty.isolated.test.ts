import { afterEach, describe, expect, test } from 'bun:test';
import {
	attachSession,
	detachSession,
	hasSession,
	killSessions,
	resizeSession,
	writeSession
} from './pty.server.ts';

/**
 * Driven against plain binaries rather than nono, which isn't installed in CI — `pty.server.ts`
 * takes its argv from the caller precisely so these mechanics can be exercised on their own.
 */
const ids: string[] = [];

function newId(): string {
	const id = `pty-test-${ids.length}-${crypto.randomUUID()}`;
	ids.push(id);
	return id;
}

afterEach(() => {
	for (const id of ids) killSessions(id);
	ids.length = 0;
});

/** PTY reads are event-loop driven, so poll rather than guessing at a sleep duration. */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('timed out waiting for PTY output');
		await Bun.sleep(10);
	}
}

function collector() {
	const chunks: Uint8Array[] = [];
	const sink = (data: Uint8Array) => chunks.push(data);
	return {
		sink,
		text: () => chunks.map((c) => new TextDecoder().decode(c)).join(''),
		reset: () => chunks.splice(0, chunks.length)
	};
}

describe('attachSession', () => {
	test('spawns a PTY and streams its output to the sink', async () => {
		const id = newId();
		const out = collector();
		// Prints, then stays alive — a process that exits is reaped from the registry immediately,
		// which is the behaviour the "reports the exit" case below covers instead.
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/sh', '-c', 'echo hello-from-pty; exec cat'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: out.sink
		});
		await waitFor(() => out.text().includes('hello-from-pty'));
		expect(hasSession(id, 'claude')).toBe(true);
	});

	test('the child sees a real TTY, which is the whole point of using a PTY', async () => {
		const id = newId();
		const out = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/sh', '-c', 'test -t 1 && echo IS_TTY || echo NOT_TTY'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: out.sink
		});
		await waitFor(() => out.text().includes('TTY'));
		expect(out.text()).toContain('IS_TTY');
	});

	test('spawns in the requested working directory', async () => {
		const id = newId();
		const out = collector();
		attachSession({
			instanceId: id,
			pane: 'shell',
			argv: ['/bin/sh', '-c', 'pwd'],
			cwd: '/tmp',
			cols: 80,
			rows: 24,
			sink: out.sink
		});
		await waitFor(() => out.text().includes('/tmp'));
	});

	test('spawns the geometry it was given, so the first paint is already the right size', async () => {
		const id = newId();
		const out = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			// `stty size` reports the PTY's window size as "rows cols".
			argv: ['/bin/sh', '-c', 'stty size'],
			cwd: process.cwd(),
			cols: 133,
			rows: 47,
			sink: out.sink
		});
		await waitFor(() => /\d+\s+\d+/.test(out.text()));
		expect(out.text()).toContain('47 133');
	});

	test('input written to a session reaches the child', async () => {
		const id = newId();
		const out = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/cat'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: out.sink
		});
		writeSession(id, 'claude', 'round-trip\n');
		await waitFor(() => out.text().includes('round-trip'));
	});

	test('replays the scrollback on reattach, then keeps streaming live', async () => {
		const id = newId();
		const first = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/cat'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: first.sink
		});
		writeSession(id, 'claude', 'before-reload\n');
		await waitFor(() => first.text().includes('before-reload'));

		// A browser reload: the socket goes away, the PTY does not.
		detachSession(id, 'claude', first.sink);
		const second = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/cat'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: second.sink
		});
		expect(second.text()).toContain('before-reload');

		writeSession(id, 'claude', 'after-reload\n');
		await waitFor(() => second.text().includes('after-reload'));
	});

	test('a second attach displaces the first rather than double-writing', async () => {
		const id = newId();
		const first = collector();
		const second = collector();
		const attach = (sink: (d: Uint8Array) => void) =>
			attachSession({
				instanceId: id,
				pane: 'claude',
				argv: ['/bin/cat'],
				cwd: process.cwd(),
				cols: 80,
				rows: 24,
				sink
			});
		attach(first.sink);
		attach(second.sink);
		first.reset();
		writeSession(id, 'claude', 'only-the-new-one\n');
		await waitFor(() => second.text().includes('only-the-new-one'));
		expect(first.text()).toBe('');
	});

	/** Or a stale socket's `close` would tear the sink out from under its replacement. */
	test('detaching a displaced sink leaves the live one attached', async () => {
		const id = newId();
		const first = collector();
		const second = collector();
		const attach = (sink: (d: Uint8Array) => void) =>
			attachSession({
				instanceId: id,
				pane: 'claude',
				argv: ['/bin/cat'],
				cwd: process.cwd(),
				cols: 80,
				rows: 24,
				sink
			});
		attach(first.sink);
		attach(second.sink);
		detachSession(id, 'claude', first.sink);
		second.reset();
		writeSession(id, 'claude', 'still-connected\n');
		await waitFor(() => second.text().includes('still-connected'));
	});

	test('the two panes of one instance are independent sessions', async () => {
		const id = newId();
		const claude = collector();
		const shell = collector();
		for (const [pane, out] of [
			['claude', claude],
			['shell', shell]
		] as const) {
			attachSession({
				instanceId: id,
				pane,
				argv: ['/bin/cat'],
				cwd: process.cwd(),
				cols: 80,
				rows: 24,
				sink: out.sink
			});
		}
		writeSession(id, 'claude', 'to-claude\n');
		await waitFor(() => claude.text().includes('to-claude'));
		expect(shell.text()).not.toContain('to-claude');
	});

	test('reports the exit rather than leaving the pane silently dead', async () => {
		const id = newId();
		const out = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/sh', '-c', 'exit 3'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: out.sink
		});
		await waitFor(() => out.text().includes('process exited'));
		expect(out.text()).toContain('code 3');
		// Dropped from the registry, so the next attach starts a fresh one.
		expect(hasSession(id, 'claude')).toBe(false);
	});
});

describe('resizeSession', () => {
	test('ignores nonsensical geometry instead of passing it to the kernel', () => {
		const id = newId();
		const out = collector();
		attachSession({
			instanceId: id,
			pane: 'claude',
			argv: ['/bin/cat'],
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
			sink: out.sink
		});
		expect(() => resizeSession(id, 'claude', 0, 24)).not.toThrow();
		expect(() => resizeSession(id, 'claude', 80, -5)).not.toThrow();
		expect(() => resizeSession(id, 'claude', 120, 40)).not.toThrow();
	});

	test('is a no-op for an unknown session', () => {
		expect(() => resizeSession('never-existed', 'claude', 80, 24)).not.toThrow();
		expect(() => writeSession('never-existed', 'claude', 'x')).not.toThrow();
	});
});

describe('killSessions', () => {
	test('tears down every pane of the instance', async () => {
		const id = newId();
		const out = collector();
		for (const pane of ['claude', 'shell'] as const) {
			attachSession({
				instanceId: id,
				pane,
				argv: ['/bin/cat'],
				cwd: process.cwd(),
				cols: 80,
				rows: 24,
				sink: out.sink
			});
		}
		expect(hasSession(id, 'claude')).toBe(true);
		expect(hasSession(id, 'shell')).toBe(true);
		killSessions(id);
		expect(hasSession(id, 'claude')).toBe(false);
		expect(hasSession(id, 'shell')).toBe(false);
	});

	test('leaves other instances alone', () => {
		const keep = newId();
		const drop = newId();
		const out = collector();
		for (const id of [keep, drop]) {
			attachSession({
				instanceId: id,
				pane: 'claude',
				argv: ['/bin/cat'],
				cwd: process.cwd(),
				cols: 80,
				rows: 24,
				sink: out.sink
			});
		}
		killSessions(drop);
		expect(hasSession(keep, 'claude')).toBe(true);
	});

	test('is a no-op for an instance that never had a session', () => {
		expect(() => killSessions('never-existed')).not.toThrow();
	});
});
