import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { LOGS_DIR } from './config.server.ts';
import {
	deleteInstanceRow,
	getRun,
	insertInstance,
	listRuns,
	openRunFor,
	type InstanceRow
} from './db.server.ts';
import { pollRunNow, runMirrorPath, startRun, stopRun } from './agent-runs.server.ts';

/**
 * Same seam as the other lifecycle tests: seeding the pinned docker slot runs everything against an
 * in-memory stub, so no daemon is involved.
 */
const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };

interface ExecCall {
	Cmd: string[];
	User: string;
	Env?: string[];
}

/**
 * Answers poll execs from a scripted queue and everything else (staging, launch) with silence.
 * Keyed off the script rather than call order, so adding a staged file can't shift the sequence.
 */
function fakeDocker(pollReplies: string[] = []) {
	const calls: ExecCall[] = [];
	const queue = [...pollReplies];
	const container = {
		inspect: async () => ({ State: { Running: true } }),
		exec: async (cfg: ExecCall) => {
			calls.push(cfg);
			const body = cfg.Cmd[2]!.includes('__CODEBAY_RUNSTATE__') ? (queue.shift() ?? '') : '';
			return {
				start: async () => {
					const s = new PassThrough();
					// Docker multiplexes stdout/stderr; demuxStream is what splits the frames back out,
					// and the stub below just forwards the payload as stdout.
					queueMicrotask(() => s.end(body));
					return s;
				},
				modem: {
					demuxStream: (s: PassThrough, out: NodeJS.WritableStream) => {
						s.on('data', (c) => out.write(c));
						s.resume();
					}
				},
				inspect: async () => ({ ExitCode: 0 })
			};
		}
	};
	g.__codebayDocker = Promise.resolve({ getContainer: () => container });
	return calls;
}

let seq = 0;
function seed(overrides: Partial<InstanceRow> = {}): InstanceRow {
	const row: InstanceRow = {
		id: `run-inst-${++seq}`,
		name: `run-inst-${seq}`,
		source_path: '/src',
		workspace_path: '/ws',
		host_port: 8100 + seq,
		container_id: 'container-run',
		remote_workspace_folder: '/workspaces/proj',
		status: 'running',
		error: null,
		created_at: Date.now(),
		bridge_token: 'tok',
		remote_user: 'node',
		image_source: 'local',
		avatar: null,
		mode: 'terminal',
		terminal_split: 0,
		config_migrated: 1,
		...overrides
	};
	insertInstance(row);
	return row;
}

const scriptOf = (call: ExecCall) => call.Cmd[2]!;
const stdinOf = (call: ExecCall) => call.Env?.[0]?.split('=').slice(1).join('=') ?? '';

/** A framed poll reply, matching what `pollScript` prints in the container. */
function pollReply(opts: { exit?: string; alive?: string; stream?: string; stderr?: string }) {
	const b64 = Buffer.from(opts.stream ?? '', 'utf8').toString('base64');
	return (
		'bash: warning: setlocale failed\n' + // login-shell noise the parser must skip past
		`__CODEBAY_RUNSTATE__${opts.exit ?? ''}\t${opts.alive ?? '1'}\n` +
		(opts.stderr ? `__CODEBAY_RUNERR__${opts.stderr}\n` : '') +
		'__CODEBAY_FETCH__\n' +
		`__CODEBAY_FILE__\t/home/node/.codebay/runs/x/stream.jsonl\n${b64}\n__CODEBAY_END__\n`
	);
}

const line = (o: unknown) => JSON.stringify(o) + '\n';

const created: string[] = [];
afterEach(() => {
	for (const id of created.splice(0)) deleteInstanceRow(id);
	g.__codebayDocker = undefined;
});
beforeEach(() => {
	g.__codebayDocker = undefined;
});

describe('startRun', () => {
	test('records the run against the sandbox and queues it', () => {
		fakeDocker();
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'add a readme badge');
		expect(run.status).toBe('queued');
		expect(run.instance_id).toBe(inst.id);
		expect(getRun(run.id)?.prompt).toBe('add a readme badge');
		expect(listRuns(inst.id)).toHaveLength(1);
	});

	test('refuses a second concurrent run, since claude shares one session dir per project', () => {
		fakeDocker();
		const inst = seed();
		created.push(inst.id);
		startRun(inst, 'first');
		expect(() => startRun(inst, 'second')).toThrow(/already has an active run/);
	});

	test('persists the launch options so a run queued before its container exists can still start', () => {
		fakeDocker();
		const inst = seed({ status: 'creating', container_id: null });
		created.push(inst.id);
		const run = startRun(inst, 'wait for me', { model: 'sonnet', maxTurns: 3 });
		expect(JSON.parse(getRun(run.id)!.options!)).toMatchObject({ model: 'sonnet', maxTurns: 3 });
	});

	test('rejects an empty prompt', () => {
		fakeDocker();
		const inst = seed();
		created.push(inst.id);
		expect(() => startRun(inst, '   ')).toThrow(/prompt is required/);
	});
});

describe('the staged launcher', () => {
	test('stages the prompt as a file and redirects every fd so the launch exec can return', async () => {
		const calls = fakeDocker();
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'do the thing');
		await pollRunNow(run.id);

		const prompt = calls.find((c) => stdinOf(c) === 'do the thing');
		expect(prompt).toBeDefined();
		expect(scriptOf(prompt!)).toContain('prompt.txt');
		expect(scriptOf(prompt!)).toContain('chmod 600');

		const runSh = calls.find((c) => stdinOf(c).includes('claude -p'));
		expect(runSh).toBeDefined();
		const body = stdinOf(runSh!);
		// A container with no resolved remote user execs as root, where claude refuses the bypass flag.
		expect(body).toContain('IS_SANDBOX=1');
		expect(body).toContain('--dangerously-skip-permissions');
		expect(body).toContain('--output-format stream-json');
		expect(body).toContain("cd '/workspaces/proj'");
		// The exit file must be written atomically, or the poller can read it half-written.
		expect(body).toContain('mv -f "$d/$1.tmp" "$d/$1"');

		const launch = calls.map(scriptOf).find((s) => s.includes('nohup'));
		expect(launch).toContain('>/dev/null 2>&1 </dev/null &');
		expect(launch).toContain('setsid');
	});

	test('splices a tightened permission mode instead of the bypass flag', async () => {
		const calls = fakeDocker();
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'careful now', { permissionMode: 'plan' });
		await pollRunNow(run.id);
		const body = calls.map(stdinOf).find((s) => s.includes('claude -p'))!;
		expect(body).toContain('--permission-mode plan');
		expect(body).not.toContain('--dangerously-skip-permissions');
	});
});

describe('polling', () => {
	test('reads the exit file before the stream, and mirrors the bytes it fetched', async () => {
		const stream =
			line({ type: 'system', subtype: 'init', session_id: 'sess-9' }) +
			line({
				type: 'assistant',
				message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] }
			});
		// Launch, then one in-flight pass, then the terminal pass.
		const calls = fakeDocker([
			pollReply({ stream, alive: '1' }),
			pollReply({
				exit: '0',
				alive: '0',
				stream: line({
					type: 'result',
					subtype: 'success',
					is_error: false,
					result: 'done!',
					num_turns: 4,
					total_cost_usd: 0.1,
					duration_ms: 1234
				})
			})
		]);
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'go');

		await pollRunNow(run.id); // launches
		const mid = await pollRunNow(run.id);
		expect(mid?.status).toBe('running');
		expect(mid?.session_id).toBe('sess-9');
		expect(mid?.last_activity).toBe('Bash(ls)');

		const done = await pollRunNow(run.id);
		expect(done?.status).toBe('done');
		expect(done?.result).toBe('done!');
		expect(done?.exit_code).toBe(0);
		expect(done?.num_turns).toBe(4);
		expect(done?.cost_usd).toBe(0.1);
		expect(done?.is_error).toBe(0);

		// The exit read precedes the tail in the script, which is what makes a same-pass exit safe.
		const poll = calls.map(scriptOf).find((s) => s.includes('__CODEBAY_RUNSTATE__'))!;
		expect(poll.indexOf('$d/exit')).toBeLessThan(poll.indexOf('__CODEBAY_FETCH__'));
		// Identity, not a bare `kill -0`: a restarted container reuses low pids.
		expect(poll).toContain('/proc/$pg/cmdline');

		const mirror = runMirrorPath(run.id);
		expect(existsSync(mirror)).toBe(true);
		expect(readFileSync(mirror, 'utf8')).toContain('sess-9');
		rmSync(mirror, { force: true });
	});

	test('a non-zero exit fails the run and reports the container stderr', async () => {
		fakeDocker([pollReply({ exit: '127', alive: '0', stderr: 'claude: not found' })]);
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'go');
		await pollRunNow(run.id);
		const done = await pollRunNow(run.id);
		expect(done?.status).toBe('error');
		expect(done?.is_error).toBe(1);
		expect(done?.error).toContain('claude: not found');
		rmSync(runMirrorPath(run.id), { force: true });
	});

	test('a dead launcher with no exit file fails the run only after repeated strikes', async () => {
		const gone = pollReply({ alive: '0' });
		fakeDocker([gone, gone, gone, gone, gone, gone]);
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'go');
		await pollRunNow(run.id);

		await pollRunNow(run.id);
		expect(getRun(run.id)?.status).toBe('running'); // one missed beat is not fatal

		for (let i = 0; i < 5; i++) await pollRunNow(run.id);
		const dead = getRun(run.id);
		expect(dead?.status).toBe('error');
		expect(dead?.error).toContain('restarted');
		rmSync(runMirrorPath(run.id), { force: true });
	});

	test('fails a queued run whose sandbox never came up', async () => {
		fakeDocker();
		const inst = seed({ status: 'error', container_id: null });
		created.push(inst.id);
		const run = startRun({ ...inst, status: 'stopped' }, 'go');
		const settled = await pollRunNow(run.id);
		expect(settled?.status).toBe('error');
		expect(settled?.error).toContain('not running');
	});
});

describe('stopRun', () => {
	test('signals the process group and marks the run cancelled', async () => {
		const calls = fakeDocker();
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'go');
		await pollRunNow(run.id);

		const stopped = await stopRun(run.id);
		expect(stopped.status).toBe('cancelled');
		expect(openRunFor(inst.id)).toBeNull();

		const kill = calls.map(scriptOf).find((s) => s.includes('kill -INT'))!;
		expect(kill).toContain('kill -INT -- "-$pg"');
		// Guarding the pgid matters: `kill -- -0` would signal every process the user owns, and a
		// stale pgid file must never signal a reused pid.
		expect(kill).toContain('/proc/$pg/cmdline');
		expect(kill).toContain('[ "$alive" = 1 ] && [ "$pg" -gt 1 ] || exit 0');
	});

	test('is a no-op on a run that already finished', async () => {
		fakeDocker([pollReply({ exit: '0', alive: '0' })]);
		const inst = seed();
		created.push(inst.id);
		const run = startRun(inst, 'go');
		await pollRunNow(run.id);
		await pollRunNow(run.id);
		expect(getRun(run.id)?.status).toBe('done');
		expect((await stopRun(run.id)).status).toBe('done');
		rmSync(runMirrorPath(run.id), { force: true });
	});
});

test('run mirrors live in the shared logs dir, so they outlive the sandbox', () => {
	expect(runMirrorPath('abc')).toBe(`${LOGS_DIR}/run-abc.jsonl`);
});
