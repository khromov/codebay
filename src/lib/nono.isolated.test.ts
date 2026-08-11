import { describe, expect, test } from 'bun:test';
import { setOption } from './db.server.ts';
import { DEFAULT_NONO_PROFILE, getNonoProfile, isNonoPane, nonoArgs } from './nono.server.ts';

const PROFILE = 'nolabs-ai/claude';

describe('nonoArgs', () => {
	test('runs the pane inside the sandbox, with the profile and the `--` separator', () => {
		const args = nonoArgs(PROFILE, 'shell', 'default');
		expect(args.slice(0, 5)).toEqual(['nono', 'run', '--profile', PROFILE, '--allow-cwd']);
		const sep = args.indexOf('--');
		expect(sep).toBeGreaterThan(0);
		expect(args.slice(sep + 1)).toEqual(['bash', '-l']);
	});

	/**
	 * Without `--allow-cwd`, `nono run` opens an interactive capability prompt that nothing in the
	 * PTY spawn path can answer — the pane would hang on a question instead of starting.
	 */
	test('always passes --allow-cwd', () => {
		for (const pane of ['claude', 'shell'] as const) {
			expect(nonoArgs(PROFILE, pane, 'default')).toContain('--allow-cwd');
		}
	});

	test('skips the post-exit rollback review that would block the fallback shell', () => {
		expect(nonoArgs(PROFILE, 'claude', 'default')).toContain('--no-rollback-prompt');
	});

	/**
	 * Regression: `--suppress-save-prompt` takes a `<PATH>`, so passing it bare made `nono run`
	 * exit 2 with "a value is required" before the pane ever started. Every flag before `--`
	 * must be a boolean, since none of them are given values here.
	 */
	test('passes no flag that requires a value', () => {
		const flags = nonoArgs(PROFILE, 'claude', 'default').slice(2);
		const beforeSeparator = flags.slice(0, flags.indexOf('--'));
		const valueTaking = ['--suppress-save-prompt', '--workdir', '--allow', '--read', '--write'];
		for (const flag of valueTaking) {
			// `--profile` is the one value-taking flag used, and it is followed by the profile.
			if (flag === '--profile') continue;
			expect(beforeSeparator).not.toContain(flag);
		}
		expect(beforeSeparator[beforeSeparator.indexOf('--profile') + 1]).toBe(PROFILE);
	});

	test('carries the permission flags the container launchers use', () => {
		const flagsFor = (mode: Parameters<typeof nonoArgs>[2]) =>
			nonoArgs(PROFILE, 'claude', mode).at(-1)!;
		expect(flagsFor('default')).toContain('claude --dangerously-skip-permissions');
		expect(flagsFor('plan')).toContain('claude --permission-mode plan');
		expect(flagsFor('manual')).toContain('claude --permission-mode manual');
	});

	// Mirrors the container launcher: when Claude exits you land in a shell, not a dead pane.
	test('the claude pane drops to a login shell inside the same sandbox', () => {
		const script = nonoArgs(PROFILE, 'claude', 'default').at(-1)!;
		expect(script).toMatch(/;\s*exec bash -l$/);
		// The whole thing is one sandboxed `bash -lc`, so the fallback can't escape it.
		const args = nonoArgs(PROFILE, 'claude', 'default');
		expect(args.slice(args.indexOf('--') + 1, -1)).toEqual(['bash', '-lc']);
	});

	test('the shell pane is sandboxed by the same profile as the claude pane', () => {
		const claude = nonoArgs(PROFILE, 'claude', 'default');
		const shell = nonoArgs(PROFILE, 'shell', 'default');
		const upToSeparator = (a: string[]) => a.slice(0, a.indexOf('--'));
		expect(upToSeparator(shell)).toEqual(upToSeparator(claude));
	});
});

describe('isNonoPane', () => {
	test('accepts only the two known panes', () => {
		expect(isNonoPane('claude')).toBe(true);
		expect(isNonoPane('shell')).toBe(true);
		for (const v of ['', 'bash', 'Shell', null, undefined, 0, {}]) {
			expect(isNonoPane(v)).toBe(false);
		}
	});
});

describe('getNonoProfile', () => {
	test('defaults to the maintained pack and honours an override', () => {
		setOption('nono_profile', '');
		expect(getNonoProfile()).toBe(DEFAULT_NONO_PROFILE);
		setOption('nono_profile', 'someone-else/claude');
		expect(getNonoProfile()).toBe('someone-else/claude');
		// Whitespace-only is a user typo, not a profile name.
		setOption('nono_profile', '   ');
		expect(getNonoProfile()).toBe(DEFAULT_NONO_PROFILE);
		setOption('nono_profile', '');
	});
});
