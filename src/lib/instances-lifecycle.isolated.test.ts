import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { deleteInstanceRow, insertInstance, setOption, type InstanceRow } from './db.server.ts';
import {
	invalidateSecretValues,
	redactSecrets,
	relaunchSurface,
	sanitizeInstance,
	startInstance
} from './instances.server.ts';
import { avatars } from '../avatars/index.ts';

/**
 * `getDocker()` resolves a client pinned to `globalThis.__codebayDocker`; seeding that slot
 * runs the lifecycle against an in-memory stub, with no daemon involved.
 */
const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };

interface ExecCall {
	Cmd: string[];
	User: string;
}

function fakeDocker(opts: { exitCode?: number; startFails?: boolean } = {}) {
	const calls = { execs: [] as ExecCall[], started: 0 };

	const container = {
		start: async () => {
			calls.started++;
			if (opts.startFails) throw Object.assign(new Error('http 500'), { statusCode: 500 });
		},
		// Reported as stopped so the reconcile that follows never spins up a health monitor.
		inspect: async () => ({ State: { Running: false } }),
		exec: async (cfg: ExecCall) => {
			calls.execs.push(cfg);
			return {
				start: async () => new PassThrough().end(),
				// The real demuxStream puts the stream in flowing mode, which is what lets 'end' fire.
				modem: { demuxStream: (s: PassThrough) => s.resume() },
				inspect: async () => ({ ExitCode: opts.exitCode ?? 0 })
			};
		}
	};

	g.__codebayDocker = Promise.resolve({ getContainer: () => container });
	return calls;
}

const realFetch = globalThis.fetch;
/** Drives `surfaceAccessible`: resolving means the port answers, rejecting means it's dead. */
function stubSurface(reachable: boolean) {
	globalThis.fetch = (async () => {
		if (!reachable) throw new Error('ECONNREFUSED');
		return new Response('ok');
	}) as unknown as typeof fetch;
}

let seq = 0;
function seed(overrides: Partial<InstanceRow> = {}): InstanceRow {
	const row: InstanceRow = {
		id: `relaunch-${++seq}`,
		name: `relaunch-${seq}`,
		source_path: '/src',
		workspace_path: '/ws',
		host_port: 8001,
		container_id: 'container-abc',
		remote_workspace_folder: '/workspace',
		status: 'stopped',
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

afterEach(() => {
	globalThis.fetch = realFetch;
	g.__codebayDocker = undefined;
});

describe('sanitizeInstance', () => {
	test('strips bridge_token and resolves a legacy null avatar to a catalog sprite', () => {
		const out = sanitizeInstance(seed({ avatar: null }));
		expect('bridge_token' in out).toBe(false);
		expect(avatars.some((a) => a.name === out.avatar)).toBe(true);
	});

	test('keeps a persisted avatar name as-is', () => {
		expect(sanitizeInstance(seed({ avatar: 'octopus' })).avatar).toBe('octopus');
	});
});

describe('relaunchSurface', () => {
	beforeEach(() => stubSurface(false));

	test('relaunches ttyd as the remote user, from the workspace folder', async () => {
		const calls = fakeDocker();
		await relaunchSurface(seed());

		expect(calls.execs).toHaveLength(1);
		const call = calls.execs[0]!;
		expect(call.User).toBe('node');
		expect(call.Cmd.slice(0, 2)).toEqual(['bash', '-lc']);
		expect(scriptOf(call)).toContain(`cd '/workspace' || exit 1`);
		expect(scriptOf(call)).toContain('ttyd --port 7681');
	});

	test('skips the launch when the surface already answers', async () => {
		stubSurface(true);
		const calls = fakeDocker();
		await relaunchSurface(seed());
		// Terminal mode has nothing else to do, so the exec is skipped outright.
		expect(calls.execs).toHaveLength(0);
	});

	test('clears the IDE run-once marker even when code-server is already back up', async () => {
		stubSurface(true);
		const calls = fakeDocker();
		// The code-server feature's entrypoint restarts the daemon on its own, but the marker
		// still has to go or the folderOpen Claude terminal never reopens.
		await relaunchSurface(seed({ mode: 'ide' }));

		expect(calls.execs).toHaveLength(1);
		expect(scriptOf(calls.execs[0]!)).toContain('rm -f "$HOME/.codebay-terminal-launched"');
		expect(scriptOf(calls.execs[0]!)).not.toContain('code-server --bind-addr');
	});

	test('never clears the injections sentinel, whose files outlive the restart', async () => {
		const calls = fakeDocker();
		await relaunchSurface(seed());
		expect(scriptOf(calls.execs[0]!)).not.toContain('codebay-injections-done');
	});

	test('falls back to root when no remote user was recorded', async () => {
		const calls = fakeDocker();
		await relaunchSurface(seed({ remote_user: null }));
		expect(calls.execs[0]!.User).toBe('root');
	});

	test('emits no cd when the remote workspace folder is unknown', async () => {
		const calls = fakeDocker();
		await relaunchSurface(seed({ remote_workspace_folder: null }));
		expect(scriptOf(calls.execs[0]!)).not.toContain('cd ');
	});

	test('single-quote-escapes a workspace folder that contains a quote', async () => {
		const calls = fakeDocker();
		await relaunchSurface(seed({ remote_workspace_folder: "/w'x" }));
		expect(scriptOf(calls.execs[0]!)).toContain(`cd '/w'\\''x' || exit 1`);
	});

	test('is a no-op for a row with no container', async () => {
		const calls = fakeDocker();
		await relaunchSurface(seed({ container_id: null }));
		expect(calls.execs).toHaveLength(0);
	});
});

describe('startInstance', () => {
	beforeEach(() => stubSurface(false));

	test('relaunches the surface after starting the container', async () => {
		const calls = fakeDocker();
		const row = seed();
		const result = await startInstance(row.id);

		expect(calls.started).toBe(1);
		expect(calls.execs).toHaveLength(1);
		expect(scriptOf(calls.execs[0]!)).toContain('ttyd --port 7681');
		expect(result.status).toBe('running');
		deleteInstanceRow(row.id);
	});

	test('a failed relaunch leaves the instance running rather than erroring it', async () => {
		const calls = fakeDocker({ exitCode: 1 });
		const row = seed();
		const result = await startInstance(row.id);

		expect(calls.execs).toHaveLength(1);
		// The container genuinely is up; the health row is what reports the dead surface.
		expect(result.status).toBe('running');
		expect(result.error).toBeNull();
		deleteInstanceRow(row.id);
	});

	test('does not attempt a relaunch when the container fails to start', async () => {
		const calls = fakeDocker({ startFails: true });
		const row = seed();
		const result = await startInstance(row.id);

		expect(calls.execs).toHaveLength(0);
		expect(result.status).toBe('error');
		deleteInstanceRow(row.id);
	});

	test('rejects an instance that has no container yet', async () => {
		fakeDocker();
		const row = seed({ container_id: null });
		await expect(startInstance(row.id)).rejects.toThrow('no container');
	});
});

describe('redactSecrets', () => {
	beforeEach(() => {
		setOption('custom_env_vars_enabled', '0');
		setOption('custom_env_vars', '[]');
		invalidateSecretValues();
	});
	afterEach(() => {
		setOption('custom_env_vars_enabled', '0');
		setOption('custom_env_vars', '[]');
		invalidateSecretValues();
	});

	test('masks every occurrence of a configured secret value', () => {
		setOption('custom_env_vars_enabled', '1');
		setOption('custom_env_vars', JSON.stringify([{ name: 'TOKEN', value: 'supersecret' }]));
		invalidateSecretValues();
		expect(redactSecrets('echo supersecret && cat supersecret')).toBe('echo •••• && cat ••••');
	});

	test('does nothing when the feature is disabled', () => {
		setOption('custom_env_vars', JSON.stringify([{ name: 'TOKEN', value: 'supersecret' }]));
		invalidateSecretValues();
		expect(redactSecrets('echo supersecret')).toBe('echo supersecret');
	});

	test('leaves values shorter than 4 chars alone so short strings do not blank the log', () => {
		setOption('custom_env_vars_enabled', '1');
		setOption('custom_env_vars', JSON.stringify([{ name: 'SHORT', value: 'ab' }]));
		invalidateSecretValues();
		expect(redactSecrets('ab about grab')).toBe('ab about grab');
	});
});
