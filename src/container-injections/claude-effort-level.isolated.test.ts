import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../lib/config.server.ts';
import { setOption, type InstanceRow } from '../lib/db.server.ts';
import {
	FALLBACK_MODEL_IDS,
	INSTALLED_MODELS_SCRIPT,
	MODEL_FAMILY_ALIASES,
	claudeEffortLevel,
	defaultRunEffort,
	describeDefaultEffort,
	effortSettingsPatch,
	hostEffortFrom,
	parseModelIds,
	uniformEffort
} from './claude-effort-level.ts';

/** The maintainer's host settings from the bug report: every level is xhigh, set both ways. */
const MAINTAINER_HOST = {
	effortLevel: 'xhigh',
	modelSettings: {
		'claude-fable-5-1': { effortLevel: 'xhigh' },
		'claude-opus-5': { effortLevel: 'xhigh' },
		'claude-opus-5-5': { effortLevel: 'xhigh' },
		'claude-fable-5-2': { effortLevel: 'xhigh' }
	}
};

const hostDir = join(DATA_DIR, 'effort-host-claude');

function writeHost(settings: unknown): void {
	mkdirSync(hostDir, { recursive: true });
	writeFileSync(join(hostDir, 'settings.json'), JSON.stringify(settings));
}

beforeEach(() => {
	rmSync(hostDir, { recursive: true, force: true });
	setOption('claude_config_dir', hostDir);
});
afterEach(() => {
	setOption('claude_config_dir', '');
	setOption('claude_effort_level', '');
});

describe('hostEffortFrom', () => {
	test('reads the top-level level and the per-model table /effort writes', () => {
		expect(hostEffortFrom(MAINTAINER_HOST)).toEqual({
			top: 'xhigh',
			perModel: {
				'claude-fable-5-1': 'xhigh',
				'claude-opus-5': 'xhigh',
				'claude-opus-5-5': 'xhigh',
				'claude-fable-5-2': 'xhigh'
			}
		});
	});

	test('ignores junk levels and entries that only carry other per-model keys', () => {
		expect(
			hostEffortFrom({
				effortLevel: 'ultra',
				modelSettings: { a: { autoCompactWindow: 1 }, b: null, c: { effortLevel: 'low' } }
			})
		).toEqual({ top: null, perModel: { c: 'low' } });
		expect(hostEffortFrom(null)).toEqual({ top: null, perModel: {} });
	});
});

describe('effortSettingsPatch', () => {
	test('inheriting writes the per-model entries current Claude Code actually reads', () => {
		const patch = effortSettingsPatch('default', hostEffortFrom(MAINTAINER_HOST), []);
		expect(patch.effortLevel).toBe('xhigh');
		// The bug: only the top-level key was written, which Claude Code 2.1 ignores for current models.
		expect(patch.modelSettings?.['claude-opus-5-5']).toEqual({ effortLevel: 'xhigh' });
		for (const alias of MODEL_FAMILY_ALIASES) {
			expect(patch.modelSettings?.[alias]).toEqual({ effortLevel: 'xhigh' });
		}
	});

	test('inheriting keeps a host level that differs per model', () => {
		const host = hostEffortFrom({
			effortLevel: 'high',
			modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } }
		});
		const patch = effortSettingsPatch('default', host, []);
		expect(patch.modelSettings?.['claude-sonnet-5-5']).toEqual({ effortLevel: 'low' });
		expect(patch.modelSettings?.opus).toEqual({ effortLevel: 'high' });
	});

	test('inheriting from a host that sets nothing writes nothing', () => {
		expect(effortSettingsPatch('default', hostEffortFrom({}), [])).toEqual({});
	});

	test('a fixed level covers the aliases, the host’s models and the configured ids', () => {
		const host = hostEffortFrom({ modelSettings: { 'claude-opus-5': { effortLevel: 'low' } } });
		const patch = effortSettingsPatch('high', host, ['eu.anthropic.claude-opus-4-6-v1']);
		expect(patch.effortLevel).toBe('high');
		for (const key of [
			...MODEL_FAMILY_ALIASES,
			'claude-opus-5',
			'eu.anthropic.claude-opus-4-6-v1'
		]) {
			expect(patch.modelSettings?.[key]).toEqual({ effortLevel: 'high' });
		}
	});

	test('max is never written, since Claude Code drops it from settings.json', () => {
		expect(effortSettingsPatch('max', hostEffortFrom({}), [])).toEqual({});
	});
});

describe('uniformEffort', () => {
	test('a fixed setting is its own default', () => {
		expect(uniformEffort('low', hostEffortFrom(MAINTAINER_HOST))).toBe('low');
	});

	test('inherits a host level that every entry agrees on', () => {
		expect(uniformEffort('default', hostEffortFrom(MAINTAINER_HOST))).toBe('xhigh');
	});

	test('defers to the container when the host’s levels differ per model', () => {
		const host = hostEffortFrom({
			effortLevel: 'xhigh',
			modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } }
		});
		expect(uniformEffort('default', host)).toBeNull();
	});
});

describe('the live default', () => {
	test('an unset option inherits the host’s xhigh', () => {
		writeHost(MAINTAINER_HOST);
		expect(defaultRunEffort()).toBe('xhigh');
		expect(describeDefaultEffort()).toBe("xhigh, inherited from the host's Claude Code settings");
	});

	test('a Codebay setting wins over the host', () => {
		writeHost(MAINTAINER_HOST);
		setOption('claude_effort_level', 'low');
		expect(defaultRunEffort()).toBe('low');
		expect(describeDefaultEffort()).toBe("low, set in Codebay's settings");
	});

	test('names per-model host levels instead of picking one', () => {
		writeHost({
			modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' }, x: { effortLevel: 'low' } }
		});
		expect(defaultRunEffort()).toBeNull();
		expect(describeDefaultEffort()).toContain('claude-opus-5-5: xhigh, x: low');
	});

	test('says so when nobody sets a level', () => {
		expect(defaultRunEffort()).toBeNull();
		expect(describeDefaultEffort()).toContain("Claude Code's own per-model default");
	});
});

const MYTHOS_IDS = [
	'claude-mythos-5-2',
	'claude-mythos-5-1',
	'claude-mythos-5',
	'claude-mythos-preview'
];

describe('Mythos coverage', () => {
	test('there is no mythos alias to lean on, so the concrete ids are the fallback floor', () => {
		// Claude Code keeps a non-alias `modelSettings` key literally, so `mythos` would match no model.
		expect(MODEL_FAMILY_ALIASES).not.toContain('mythos');
		expect(FALLBACK_MODEL_IDS).toEqual(MYTHOS_IDS);
	});

	test('a fixed level reaches every Mythos id', () => {
		const patch = effortSettingsPatch('xhigh', hostEffortFrom({}), MYTHOS_IDS);
		for (const id of MYTHOS_IDS)
			expect(patch.modelSettings?.[id]).toEqual({ effortLevel: 'xhigh' });
	});

	test('the host’s top-level level reaches every Mythos id, and its own per-model entries still win', () => {
		const host = hostEffortFrom({
			effortLevel: 'xhigh',
			modelSettings: { 'claude-mythos-5-1': { effortLevel: 'low' } }
		});
		const patch = effortSettingsPatch('default', host, MYTHOS_IDS);
		expect(patch.modelSettings?.['claude-mythos-5-2']).toEqual({ effortLevel: 'xhigh' });
		expect(patch.modelSettings?.['claude-mythos-preview']).toEqual({ effortLevel: 'xhigh' });
		expect(patch.modelSettings?.['claude-mythos-5-1']).toEqual({ effortLevel: 'low' });
	});
});

describe('reading the installed Claude Code’s model catalog', () => {
	test('parseModelIds keeps base ids and drops dated snapshots and junk', () => {
		const out = [
			'"claude-mythos-5-2"',
			'"claude-mythos-preview"',
			'"claude-opus-4-20250514"',
			'"claude-opus-5-5"',
			'"claude-opus-5-5"',
			'bash: warning: setlocale failed',
			''
		].join('\n');
		expect(parseModelIds(out)).toEqual([
			'claude-mythos-5-2',
			'claude-mythos-preview',
			'claude-opus-5-5'
		]);
	});

	// Runs the real script through bash, which a Windows runner doesn't have.
	test.skipIf(process.platform === 'win32')(
		'the script finds the ids inside a binary reached through a symlinked `claude`',
		async () => {
			const dir = join(DATA_DIR, 'effort-fake-claude');
			rmSync(dir, { recursive: true, force: true });
			mkdirSync(join(dir, 'bin'), { recursive: true });
			const binary = join(dir, 'claude.exe');
			// Minified-catalog shaped: ids as string literals among binary noise, plus a future model.
			writeFileSync(
				binary,
				Buffer.concat([
					Buffer.from([0, 1, 2, 255]),
					Buffer.from(
						'var x=["claude-mythos-5-2","claude-mythos-6","claude-fable-5-2"],y="claude-code-sdk",' +
							'z="claude-sonnet-4-5-20250929";'
					),
					Buffer.from([0, 0, 254])
				])
			);
			chmodSync(binary, 0o755);
			symlinkSync(binary, join(dir, 'bin', 'claude'));
			const proc = Bun.spawn(['bash', '-c', INSTALLED_MODELS_SCRIPT], {
				env: { ...process.env, PATH: `${join(dir, 'bin')}:/usr/bin:/bin` },
				stdout: 'pipe'
			});
			const ids = parseModelIds(await new Response(proc.stdout).text());
			expect(ids).toEqual(['claude-fable-5-2', 'claude-mythos-5-2', 'claude-mythos-6']);
			rmSync(dir, { recursive: true, force: true });
		}
	);
});

describe('apply()', () => {
	const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };
	afterEach(() => {
		g.__codebayDocker = undefined;
	});

	/** Answers the catalog script with `catalog` and every other exec with silence, recording stdin. */
	function fakeDocker(catalog: string | null) {
		const stdins: string[] = [];
		const container = {
			exec: async (cfg: { Cmd: string[]; Env?: string[] }) => {
				const isCatalog = cfg.Cmd[2]!.includes('grep -aoE');
				stdins.push(cfg.Env?.[0]?.split('=').slice(1).join('=') ?? '');
				// A read script gets the marker's "absent" reply, so the merge starts from an empty file.
				const body = isCatalog
					? (catalog ?? '')
					: cfg.Cmd[2]!.includes('__CODEBAY_READ__')
						? '__CODEBAY_READ__A'
						: '';
				return {
					start: async () => {
						const st = new PassThrough();
						queueMicrotask(() => st.end(body));
						return st;
					},
					modem: {
						demuxStream: (st: PassThrough, out: NodeJS.WritableStream) => {
							st.on('data', (c) => out.write(c));
							st.resume();
						}
					},
					inspect: async () => ({ ExitCode: isCatalog && catalog === null ? 1 : 0 })
				};
			}
		};
		g.__codebayDocker = Promise.resolve({ getContainer: () => container });
		return stdins;
	}

	async function writtenModelSettings(catalog: string | null) {
		const stdins = fakeDocker(catalog);
		// apply() never reads the row, so an empty stand-in keeps the test off the instances table.
		const target = { containerId: 'c', remoteUser: 'node', instance: {} as InstanceRow };
		await claudeEffortLevel.apply(target, () => {});
		const settings = stdins
			.map((raw) => {
				try {
					return JSON.parse(raw) as { modelSettings?: Record<string, { effortLevel: string }> };
				} catch {
					return null;
				}
			})
			.find((json) => json?.modelSettings);
		return settings?.modelSettings ?? {};
	}

	test('keys every model the installed Claude Code knows, including one newer than this list', async () => {
		writeHost({ effortLevel: 'xhigh' });
		const written = await writtenModelSettings('"claude-mythos-6"\n"claude-opus-6"\n');
		expect(written['claude-mythos-6']).toEqual({ effortLevel: 'xhigh' });
		expect(written['claude-opus-6']).toEqual({ effortLevel: 'xhigh' });
		for (const id of MYTHOS_IDS) expect(written[id]).toEqual({ effortLevel: 'xhigh' });
	});

	test('still covers Mythos when the catalog can’t be read', async () => {
		setOption('claude_effort_level', 'high');
		const written = await writtenModelSettings(null);
		for (const id of MYTHOS_IDS) expect(written[id]).toEqual({ effortLevel: 'high' });
		expect(written.opus).toEqual({ effortLevel: 'high' });
	});
});
