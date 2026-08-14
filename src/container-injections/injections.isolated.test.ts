import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injections, resolveInjections, resolveInjectionStages } from '../lib/injections.server.ts';
import { setOption } from '../lib/db.server.ts';
import { attentionHookSettings, hasAttentionHook } from './attention-hooks.ts';
import { isValid, LIVE_CREDENTIALS_TEST, tokenCredentials } from './claude-code-credentials.ts';
import { customEndpointConfig } from './claude-code-custom.ts';
import { gitIdentity, gitIdentityEnabled, readGitIdentity } from './git-identity.ts';
import { manualModelConfig } from './claude-code-models.ts';
import { ghHostBlock, parseGhHosts } from './github-credentials.ts';
import { hostEnvVarPresence, hostEnvVarsConfig, parseHostEnvVarNames } from './host-env-vars.ts';
import { customEnvVarsConfig, customEnvVarValues, parseCustomEnvVars } from './custom-env-vars.ts';
import { expandTilde, extractScriptPath } from './claude-statusline.ts';
import { hostClaudeModel } from './claude-model.ts';
import { NO_COAUTHOR_SETTINGS } from './claude-no-coauthor.ts';
import { claudeTrustConfig, CLAUDE_TRUST_SETTINGS } from './claude-trust.ts';
import { homedir } from 'node:os';
import { INSTALL_SCRIPT, TMUX_CONF_LINES } from './tmux.ts';
import { INSTALL_SCRIPT as TTYD_INSTALL_SCRIPT } from './ttyd.ts';
import { INSTALL_SCRIPT as CLAUDE_INSTALL_SCRIPT } from './claude-code-install.ts';
import {
	CHECK_SCRIPT as EXT_CHECK_SCRIPT,
	EXTENSION_ID,
	INSTALL_SCRIPT as EXT_INSTALL_SCRIPT
} from './claude-code-ide-extension.ts';
import {
	CACHE_TTL_MS,
	cacheIsFresh,
	fetchLatestVersion,
	PINNED_UPDATE_SCRIPT,
	UPDATE_SCRIPT,
	VERSION_RE
} from './claude-code-update.ts';
import {
	CHECK_SCRIPT as DARK_CHECK_SCRIPT,
	darkenThemeManifest,
	pickDarkThemeId,
	RESOLVE_ROOT_SCRIPT
} from './code-server-dark.ts';

describe('injection registry', () => {
	test('every injection has a unique id', () => {
		const ids = injections.map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('resolveInjections returns unique ids', () => {
		const ids = resolveInjections().map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('injections that declare auth provide a hint and status()', () => {
		for (const i of injections) {
			if (!i.auth) continue;
			expect(typeof i.auth.hint).toBe('string');
			expect(typeof i.auth.status).toBe('function');
		}
	});

	test('git-safe-directory applies but reports no health (no check)', () => {
		const git = injections.find((i) => i.id === 'git-safe-directory');
		expect(git).toBeDefined();
		expect(git!.check).toBeUndefined();
	});

	test('git-identity is registered with an auth chip and a health check', () => {
		const identity = injections.find((i) => i.id === 'git-identity');
		expect(identity).toBeDefined();
		expect(identity!.auth).toBeDefined();
		expect(typeof identity!.check).toBe('function');
	});

	test('claude-permission-mode is registered with a health check', () => {
		const alias = injections.find((i) => i.id === 'claude-permission-mode');
		expect(alias).toBeDefined();
		expect(typeof alias!.check).toBe('function');
		expect(alias!.auth).toBeUndefined();
	});

	test('claude-aliases is registered with a health check', () => {
		const aliases = injections.find((i) => i.id === 'claude-aliases');
		expect(aliases).toBeDefined();
		expect(typeof aliases!.check).toBe('function');
		expect(aliases!.auth).toBeUndefined();
	});

	test('claude-no-coauthor is registered with a health check', () => {
		const noCoauthor = injections.find((i) => i.id === 'claude-no-coauthor');
		expect(noCoauthor).toBeDefined();
		expect(typeof noCoauthor!.check).toBe('function');
		expect(noCoauthor!.auth).toBeUndefined();
	});

	test('claude-trust is registered with a health check', () => {
		const trust = injections.find((i) => i.id === 'claude-trust');
		expect(trust).toBeDefined();
		expect(typeof trust!.check).toBe('function');
		expect(trust!.auth).toBeUndefined();
	});

	test('claude-statusline is registered with an auth chip and a health check', () => {
		const statusline = injections.find((i) => i.id === 'claude-statusline');
		expect(statusline).toBeDefined();
		expect(statusline!.auth).toBeDefined();
		expect(typeof statusline!.check).toBe('function');
	});

	test('claude-model is registered with a health check and no auth chip', () => {
		const model = injections.find((i) => i.id === 'claude-model');
		expect(model).toBeDefined();
		// Mirrors the host default silently; it deliberately draws no credentials-menu chip.
		expect(model!.auth).toBeUndefined();
		expect(typeof model!.check).toBe('function');
	});

	test('claude-effort-level is registered with a health check and no auth chip', () => {
		const effort = injections.find((i) => i.id === 'claude-effort-level');
		expect(effort).toBeDefined();
		// Writes a settings.json default from the app option; no host dependency, so no chip.
		expect(effort!.auth).toBeUndefined();
		expect(typeof effort!.check).toBe('function');
	});

	test('host-env-vars is registered with a health check and no auth chip', () => {
		const hostEnvVars = injections.find((i) => i.id === 'host-env-vars');
		expect(hostEnvVars).toBeDefined();
		expect(typeof hostEnvVars!.check).toBe('function');
		// Opt-in convenience feature, not a discovered host credential — omitting
		// `auth` keeps it out of the global credentials chip when unconfigured.
		expect(hostEnvVars!.auth).toBeUndefined();
	});

	test('custom-env-vars is registered with a health check and no auth chip', () => {
		const custom = injections.find((i) => i.id === 'custom-env-vars');
		expect(custom).toBeDefined();
		expect(typeof custom!.check).toBe('function');
		// Values come from Settings, not a discovered host credential, so it draws no auth chip.
		expect(custom!.auth).toBeUndefined();
	});

	test('tmux is registered with a health check', () => {
		const t = injections.find((i) => i.id === 'tmux');
		expect(t).toBeDefined();
		expect(typeof t!.check).toBe('function');
		expect(t!.auth).toBeUndefined();
	});

	test('claude-code-update is registered with no auth chip and no health check', () => {
		const update = injections.find((i) => i.id === 'claude-code-update');
		expect(update).toBeDefined();
		// A check() would fire an `npm view` network call on every health tick — too costly.
		expect(update!.auth).toBeUndefined();
		expect(update!.check).toBeUndefined();
	});

	test('claude-code-ide-extension is registered with a health check and no auth chip', () => {
		const ext = injections.find((i) => i.id === 'claude-code-ide-extension');
		expect(ext).toBeDefined();
		expect(typeof ext!.check).toBe('function');
		// No host-side credential dependency, so it draws no setup-UI chip.
		expect(ext!.auth).toBeUndefined();
	});

	test('git-safe-directory and tmux start in the first stage', () => {
		// safe.directory must precede every later git-touching step, and tmux's package
		// install is the slowest injection, so both must kick off immediately.
		const firstStage = resolveInjectionStages()[0]!.map((i) => i.id);
		expect(firstStage).toContain('git-safe-directory');
		expect(firstStage).toContain('tmux');
	});

	test('ttyd is registered as a terminal-only injection with a health check', () => {
		const t = injections.find((i) => i.id === 'ttyd');
		expect(t).toBeDefined();
		expect(t!.modes).toEqual(['terminal']);
		expect(typeof t!.check).toBe('function');
		expect(t!.auth).toBeUndefined();
	});
});

describe('resolveInjectionStages — clobber safety', () => {
	// Container resources each apply() writes. Two same-stage writers of one resource would race:
	// every JSON/rc edit is an unguarded read-modify-write, and parallel apt-gets fight the dpkg lock.
	const WRITES: Record<string, string[]> = {
		'git-safe-directory': ['gitconfig'],
		tmux: ['apt', 'tmux-conf'],
		ttyd: ['apt', 'usr-local-bin'],
		'claude-code-install': ['npm-global', 'usr-local-bin'],
		'claude-code-update': ['npm-global'],
		'claude-code-credentials': ['claude-credentials', 'claude-json'],
		'claude-code-custom': ['claude-env-file', 'rc', 'claude-json'],
		'claude-code-ide-extension': ['extensions-dir'],
		'code-server-dark': ['code-server-install', 'code-server-user-settings'],
		'git-identity': ['gitconfig'],
		'github-credentials': ['gh-hosts', 'gitconfig'],
		'claude-effort-level': ['settings-json'],
		'attention-hooks': ['bridge-header', 'settings-json'],
		'claude-statusline': ['statusline-script', 'settings-json'],
		'claude-code-models': ['models-env-file', 'rc'],
		'claude-model': ['settings-json'],
		'claude-permission-mode': ['rc'],
		'claude-trust': ['claude-json', 'settings-json'],
		'claude-aliases': ['rc'],
		'claude-no-coauthor': ['settings-json'],
		'host-env-vars': ['host-env-file', 'rc'],
		// Writes nothing to the container — values ride containerEnv, so it can share any stage.
		'custom-env-vars': []
	};

	function stageOf(stages: { id: string }[][]): Map<string, number> {
		const index = new Map<string, number>();
		stages.forEach((stage, n) => stage.forEach((i) => index.set(i.id, n)));
		return index;
	}

	function assertNoSameStageClobber(stages: { id: string }[][]) {
		for (const stage of stages) {
			const seen = new Map<string, string>();
			for (const injection of stage) {
				const writes = WRITES[injection.id];
				// A new injection must be added to the map, or this test can't vouch for it.
				expect(writes).toBeDefined();
				for (const resource of writes!) {
					expect(`${resource} ← ${seen.get(resource) ?? ''}`).toBe(`${resource} ← `);
					seen.set(resource, injection.id);
				}
			}
		}
	}

	test('no two injections in one stage write the same resource (both Claude slots, both modes)', () => {
		for (const enabled of ['0', '1']) {
			setOption('custom_endpoint_enabled', enabled);
			for (const mode of [undefined, 'ide', 'terminal'] as const) {
				assertNoSameStageClobber(resolveInjectionStages(mode));
			}
		}
		setOption('custom_endpoint_enabled', '0');
	});

	test('shared resources keep their pre-parallelization write order across stages', () => {
		const at = stageOf(resolveInjectionStages());
		// gitconfig: safe.directory before identity before gh's credential helper rewrite.
		expect(at.get('git-safe-directory')!).toBeLessThan(at.get('git-identity')!);
		expect(at.get('git-identity')!).toBeLessThan(at.get('github-credentials')!);
		// ~/.claude/settings.json merge chain.
		expect(at.get('claude-effort-level')!).toBeLessThan(at.get('attention-hooks')!);
		expect(at.get('attention-hooks')!).toBeLessThan(at.get('claude-statusline')!);
		expect(at.get('claude-statusline')!).toBeLessThan(at.get('claude-model')!);
		expect(at.get('claude-model')!).toBeLessThan(at.get('claude-trust')!);
		expect(at.get('claude-trust')!).toBeLessThan(at.get('claude-no-coauthor')!);
		// rc-file append chain.
		expect(at.get('claude-code-models')!).toBeLessThan(at.get('claude-permission-mode')!);
		expect(at.get('claude-permission-mode')!).toBeLessThan(at.get('claude-aliases')!);
		expect(at.get('claude-aliases')!).toBeLessThan(at.get('host-env-vars')!);
		// ~/.claude.json: the Claude slot seeds it before trust merges into it.
		expect(at.get('claude-code-credentials')!).toBeLessThan(at.get('claude-trust')!);
		// apt/dpkg lock: tmux and ttyd can never run side by side.
		expect(at.get('tmux')!).toBeLessThan(at.get('ttyd')!);
		// npm global: install lands the binary before update refreshes it (update no-ops until then).
		expect(at.get('claude-code-install')!).toBeLessThan(at.get('claude-code-update')!);
		// /usr/local/bin symlink: install and ttyd both write it, so they can never share a stage.
		expect(at.get('claude-code-install')!).toBeLessThan(at.get('ttyd')!);
	});

	test('the custom Claude slot (an rc writer) stays ahead of every other rc writer', () => {
		setOption('custom_endpoint_enabled', '1');
		try {
			const at = stageOf(resolveInjectionStages());
			expect(at.get('claude-code-custom')!).toBeLessThan(at.get('claude-code-models')!);
		} finally {
			setOption('custom_endpoint_enabled', '0');
		}
	});
});

describe('resolveInjectionStages — serial escape hatch', () => {
	afterEach(() => setOption('advanced_serial_injections', '0'));

	test('one injection per stage, preserving the parallel layout order exactly', () => {
		const parallelOrder = resolveInjectionStages('ide')
			.flat()
			.map((i) => i.id);
		setOption('advanced_serial_injections', '1');
		const serial = resolveInjectionStages('ide');
		for (const stage of serial) expect(stage.length).toBe(1);
		expect(serial.flat().map((i) => i.id)).toEqual(parallelOrder);
	});

	test('mode filtering still applies in serial mode', () => {
		setOption('advanced_serial_injections', '1');
		const ids = resolveInjectionStages('terminal')
			.flat()
			.map((i) => i.id);
		expect(ids).toContain('ttyd');
		expect(ids).not.toContain('claude-code-ide-extension');
	});
});

describe('resolveInjections — mode filtering', () => {
	test('terminal mode adds ttyd and drops the code-server IDE extension', () => {
		const ids = resolveInjections('terminal').map((i) => i.id);
		expect(ids).toContain('ttyd');
		expect(ids).not.toContain('claude-code-ide-extension');
	});

	test('ide mode adds the IDE extension and drops ttyd', () => {
		const ids = resolveInjections('ide').map((i) => i.id);
		expect(ids).toContain('claude-code-ide-extension');
		expect(ids).not.toContain('ttyd');
	});

	test('claude-code-install is terminal-only and runs before every claude-* step', () => {
		const terminal = resolveInjections('terminal').map((i) => i.id);
		expect(terminal).toContain('claude-code-install');
		// The tail (update, credentials, trust, aliases…) all assume a `claude` binary exists.
		expect(terminal.indexOf('claude-code-install')).toBeLessThan(
			terminal.indexOf('claude-code-update')
		);
		// IDE mode on a project image keeps deferring tooling to the project.
		expect(resolveInjections('ide').map((i) => i.id)).not.toContain('claude-code-install');
	});

	test('mode-agnostic (no argument) keeps every injection', () => {
		const ids = resolveInjections().map((i) => i.id);
		expect(ids).toContain('ttyd');
		expect(ids).toContain('claude-code-ide-extension');
	});
});

describe('ttyd injection script', () => {
	test('short-circuits when ttyd is already present', () => {
		expect(
			TTYD_INSTALL_SCRIPT.startsWith('if command -v ttyd >/dev/null 2>&1; then exit 0; fi;')
		).toBe(true);
	});

	test('tries package managers and falls back to the upstream static binary', () => {
		expect(TTYD_INSTALL_SCRIPT).toContain('apt-get');
		expect(TTYD_INSTALL_SCRIPT).toContain('apk');
		expect(TTYD_INSTALL_SCRIPT).toContain('releases/latest/download/ttyd.');
	});
});

describe('claude-code-install script', () => {
	test('sniffs first, so an image that already ships Claude Code is left alone', () => {
		expect(
			CLAUDE_INSTALL_SCRIPT.startsWith('if command -v claude >/dev/null 2>&1; then exit 0; fi')
		).toBe(true);
	});

	test('never installs Node via nvm', () => {
		// The whole point: the upstream node feature's nvm install aborts on any image that
		// sets NPM_CONFIG_PREFIX, which is what broke terminal-mode builds.
		expect(CLAUDE_INSTALL_SCRIPT).not.toContain('nvm');
		expect(CLAUDE_INSTALL_SCRIPT).toContain('npm install -g @anthropic-ai/claude-code@latest');
		// The no-Node fallback needs no Node at all.
		expect(CLAUDE_INSTALL_SCRIPT).toContain('https://claude.ai/install.sh');
	});

	test('runs the standalone installer as the remote user, not root', () => {
		// It installs under $HOME, so running as root would strand the binary in /root.
		expect(CLAUDE_INSTALL_SCRIPT).toContain('u="${1:-${_REMOTE_USER:-root}}"');
		expect(CLAUDE_INSTALL_SCRIPT).toContain('su -m "$u"');
		// …and the result has to be on every user's PATH, including root's.
		expect(CLAUDE_INSTALL_SCRIPT).toContain('ln -sf "$h/.local/bin/claude" /usr/local/bin/claude');
	});
});

describe('tmux injection scripts', () => {
	test('install script short-circuits when tmux is already present', () => {
		expect(INSTALL_SCRIPT.startsWith('if command -v tmux >/dev/null 2>&1; then exit 0; fi;')).toBe(
			true
		);
	});

	test('install script covers the supported package managers', () => {
		for (const pm of ['apt-get', 'apk', 'dnf', 'microdnf', 'yum']) {
			expect(INSTALL_SCRIPT).toContain(pm);
		}
	});

	test('conf enables mouse scrollback and hides the status bar', () => {
		expect(TMUX_CONF_LINES).toContain('set -g mouse on');
		expect(TMUX_CONF_LINES).toContain('set -g status off');
	});

	test('conf binds a key to toggle mouse mode for copy/paste vs. scroll', () => {
		expect(TMUX_CONF_LINES.some((line) => line.startsWith('bind m set -g mouse'))).toBe(true);
	});
});

describe('claude-code-ide-extension scripts', () => {
	test('install script targets the Open VSX extension id', () => {
		expect(EXTENSION_ID).toBe('anthropic.claude-code');
		expect(EXT_INSTALL_SCRIPT).toContain('--install-extension anthropic.claude-code');
	});

	test('install script short-circuits when the extension is already present', () => {
		expect(
			EXT_INSTALL_SCRIPT.startsWith(
				'if ls -d ~/.local/share/code-server/extensions/anthropic.claude-code-*'
			)
		).toBe(true);
	});

	test('install script waits out the launch line’s background install before falling back', () => {
		// The bracket keeps pgrep from matching this script's own `bash -lc` argv.
		expect(EXT_INSTALL_SCRIPT).toContain("pgrep -f 'install-extensio[n] anthropic.claude-code'");
		// Bounded wait, then a re-check so a completed background install exits without a second download.
		expect(EXT_INSTALL_SCRIPT).toContain('{1..90}');
		const waitAt = EXT_INSTALL_SCRIPT.indexOf('pgrep');
		const recheckAt = EXT_INSTALL_SCRIPT.lastIndexOf('if ls -d');
		expect(waitAt).toBeLessThan(recheckAt);
		expect(recheckAt).toBeLessThan(EXT_INSTALL_SCRIPT.indexOf('code-server --install-extension'));
	});

	// Run the probe against a temp home, exactly as `checkPresence` would in a container.
	function runCheck(home: string): string {
		const res = Bun.spawnSync(['bash', '-c', EXT_CHECK_SCRIPT], {
			env: { ...process.env, HOME: home }
		});
		return res.stdout.toString().trim();
	}

	test('check reports 1 when an extension dir exists, 0 otherwise', () => {
		const home = mkdtempSync(join(tmpdir(), 'codebay-ext-'));
		try {
			expect(runCheck(home)).toBe('0');
			mkdirSync(join(home, '.local/share/code-server/extensions/anthropic.claude-code-2.1.220'), {
				recursive: true
			});
			expect(runCheck(home)).toBe('1');
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe('claude-code-update script', () => {
	test('short-circuits when claude or npm is missing', () => {
		expect(UPDATE_SCRIPT).toContain('command -v claude >/dev/null 2>&1 || exit 0');
		expect(UPDATE_SCRIPT).toContain('command -v npm >/dev/null 2>&1 || exit 0');
	});

	test('reinstalls the latest npm build when behind', () => {
		expect(UPDATE_SCRIPT).toContain('npm install -g @anthropic-ai/claude-code@latest');
	});

	// Verbatim `claude --version` / `npm view … version` outputs captured from a live container
	// (claude 2.1.220, npm latest 2.1.222 — 2026-08), so the parse pipeline is pinned to the real
	// shapes claude emits, not a guessed one.
	const CLAUDE_VERSION_FIXTURES: { raw: string; version: string }[] = [
		{ raw: '2.1.220 (Claude Code)', version: '2.1.220' },
		{ raw: '1.0.5 (Claude Code)', version: '1.0.5' }
	];
	const NPM_VIEW_FIXTURE = '2.1.222';

	// Run the script with fake `claude`/`npm` shims on PATH that print the raw fixtures verbatim,
	// exactly as it runs in a container. The script silences npm output, so `npm install` records
	// itself via a marker file instead.
	function runUpdate(rawClaude: string, rawNpmView: string): { out: string; installed: boolean } {
		const bin = mkdtempSync(join(tmpdir(), 'codebay-update-'));
		const marker = join(bin, 'install-called');
		try {
			writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat <<'FIXTURE'\n${rawClaude}\nFIXTURE\n`, {
				mode: 0o755
			});
			writeFileSync(
				join(bin, 'npm'),
				`#!/bin/sh\nif [ "$1" = view ]; then cat <<'FIXTURE'\n${rawNpmView}\nFIXTURE\nelse touch "${marker}"; fi\n`,
				{ mode: 0o755 }
			);
			const res = Bun.spawnSync(['bash', '-c', UPDATE_SCRIPT], {
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
			});
			return { out: res.stdout.toString().trim(), installed: existsSync(marker) };
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
	}

	test('parses the version out of the real `claude --version` output and upgrades when behind', () => {
		for (const { raw, version } of CLAUDE_VERSION_FIXTURES) {
			const { out, installed } = runUpdate(raw, NPM_VIEW_FIXTURE);
			expect(installed).toBe(true);
			expect(out).toContain(`updated ${version} -> ${NPM_VIEW_FIXTURE}`);
		}
	});

	test('does not reinstall when the parsed version already matches npm latest', () => {
		const { out, installed } = runUpdate(`${NPM_VIEW_FIXTURE} (Claude Code)`, NPM_VIEW_FIXTURE);
		expect(installed).toBe(false);
		expect(out).toContain(`current ${NPM_VIEW_FIXTURE}`);
	});

	test('skips the upgrade when `npm view` returns nothing (offline/firewalled registry)', () => {
		const { out, installed } = runUpdate('2.1.220 (Claude Code)', '');
		expect(installed).toBe(false);
		expect(out).toBe('');
	});

	// Same shim harness, but the latest version arrives as `$0` instead of via `npm view`.
	function runPinned(
		rawClaude: string | null,
		latest: string
	): { out: string; installed: boolean } {
		const bin = mkdtempSync(join(tmpdir(), 'codebay-pinned-'));
		const marker = join(bin, 'install-called');
		try {
			if (rawClaude !== null) {
				writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat <<'FIXTURE'\n${rawClaude}\nFIXTURE\n`, {
					mode: 0o755
				});
			}
			writeFileSync(join(bin, 'npm'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
			// PATH is pinned (not prepended) so a claude installed on the host can't leak into
			// the "claude missing" case.
			const res = Bun.spawnSync(['bash', '-c', PINNED_UPDATE_SCRIPT, latest], {
				env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }
			});
			return { out: res.stdout.toString().trim(), installed: existsSync(marker) };
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
	}

	test('pinned script never runs `npm view` and upgrades when behind the supplied version', () => {
		expect(PINNED_UPDATE_SCRIPT).not.toContain('npm view');
		const { out, installed } = runPinned('2.1.220 (Claude Code)', '2.1.222');
		expect(installed).toBe(true);
		expect(out).toContain('updated 2.1.220 -> 2.1.222');
	});

	test('pinned script does not reinstall when already at the supplied version', () => {
		const { out, installed } = runPinned('2.1.222 (Claude Code)', '2.1.222');
		expect(installed).toBe(false);
		expect(out).toContain('current 2.1.222');
	});

	test('pinned script exits silently when claude is not installed', () => {
		const { out, installed } = runPinned(null, '2.1.222');
		expect(installed).toBe(false);
		expect(out).toBe('');
	});
});

describe('claude-code version cache helpers', () => {
	test('VERSION_RE accepts plain semver and rejects everything else', () => {
		expect(VERSION_RE.test('2.1.222')).toBe(true);
		for (const bad of ['v2.1.222', '2.1.222-beta.1', '2.1', '', '2.1.222; rm -rf /', '2.1.222 ']) {
			expect(VERSION_RE.test(bad)).toBe(false);
		}
	});

	test('cacheIsFresh honors the TTL window', () => {
		const now = 1_000_000_000;
		expect(cacheIsFresh(String(now - 1), now)).toBe(true);
		expect(cacheIsFresh(String(now - CACHE_TTL_MS + 1), now)).toBe(true);
		expect(cacheIsFresh(String(now - CACHE_TTL_MS), now)).toBe(false);
	});

	test('cacheIsFresh rejects unset, empty, zero, and garbage timestamps', () => {
		for (const bad of [null, '', '0', 'garbage', 'NaN']) {
			expect(cacheIsFresh(bad, Date.now())).toBe(false);
		}
	});

	// Bun's fetch type carries extras like preconnect, so the shim is cast once here.
	async function withFetch<T>(impl: () => Promise<Response>, fn: () => Promise<T>): Promise<T> {
		const original = globalThis.fetch;
		globalThis.fetch = impl as unknown as typeof fetch;
		try {
			return await fn();
		} finally {
			globalThis.fetch = original;
		}
	}

	test('fetchLatestVersion returns a validated version from the registry payload', async () => {
		const version = await withFetch(
			async () => Response.json({ version: '2.1.222' }),
			fetchLatestVersion
		);
		expect(version).toBe('2.1.222');
	});

	test('fetchLatestVersion returns null on HTTP errors, bad payloads, and network failures', async () => {
		const cases: (() => Promise<Response>)[] = [
			async () => new Response('nope', { status: 500 }),
			async () => Response.json({ version: 'not-a-version' }),
			async () => Response.json({}),
			async () => new Response('not json'),
			async () => {
				throw new Error('offline');
			}
		];
		for (const impl of cases) {
			expect(await withFetch(impl, fetchLatestVersion)).toBeNull();
		}
	});
});

describe('attentionHookSettings', () => {
	test('emits a Claude settings object with the three lifecycle hooks', () => {
		const settings = attentionHookSettings('inst-123');
		const hooks = settings.hooks as Record<string, unknown>;
		expect(Object.keys(hooks).sort()).toEqual(['Notification', 'Stop', 'UserPromptSubmit']);
		const json = JSON.stringify(settings);
		// The instance id must reach the curl command so the bridge can route it.
		expect(json).toContain('inst-123');
		// The token must NOT be baked into settings.json — the hooks read it from a
		// mode-600 header file at runtime, keeping it off curl's argv (and out of ps).
		expect(json).toContain('.bridge-header');
	});
});

describe('hasAttentionHook', () => {
	test('matches settings carrying the instance hooks', () => {
		expect(hasAttentionHook(attentionHookSettings('inst-abc'), 'inst-abc')).toBe(true);
	});

	test('rejects a different instance id, empty settings, and null', () => {
		expect(hasAttentionHook(attentionHookSettings('inst-abc'), 'inst-xyz')).toBe(false);
		expect(hasAttentionHook({}, 'inst-abc')).toBe(false);
		expect(hasAttentionHook(null, 'inst-abc')).toBe(false);
	});

	test('an id that is a prefix of the installed one does not match', () => {
		expect(hasAttentionHook(attentionHookSettings('inst-abcdef'), 'inst-abc')).toBe(false);
	});
});

describe('resolveInjections — custom endpoint toggle', () => {
	beforeEach(() => {
		// Start each test with the feature off and a clean slate.
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	afterEach(() => {
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	test('uses claude-code-credentials when custom endpoint is disabled', () => {
		const ids = resolveInjections().map((i) => i.id);
		expect(ids).toContain('claude-code-credentials');
		expect(ids).not.toContain('claude-code-custom');
	});

	test('uses claude-code-custom when custom endpoint is enabled', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const ids = resolveInjections().map((i) => i.id);
		expect(ids).toContain('claude-code-custom');
		expect(ids).not.toContain('claude-code-credentials');
	});

	test('never includes both Claude injections at once', () => {
		const idsOff = resolveInjections().map((i) => i.id);
		const hasCredentials = idsOff.includes('claude-code-credentials');
		const hasCustom = idsOff.includes('claude-code-custom');
		expect(hasCredentials && hasCustom).toBe(false);

		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const idsOn = resolveInjections().map((i) => i.id);
		const hasCredentialsOn = idsOn.includes('claude-code-credentials');
		const hasCustomOn = idsOn.includes('claude-code-custom');
		expect(hasCredentialsOn && hasCustomOn).toBe(false);
	});
});

describe('customEndpointConfig', () => {
	beforeEach(() => {
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	afterEach(() => {
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	test('returns null when disabled', () => {
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		expect(customEndpointConfig()).toBeNull();
	});

	test('returns null when enabled but base URL is blank', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_token', 'sk-test');
		expect(customEndpointConfig()).toBeNull();
	});

	test('returns null when enabled but token is blank', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		expect(customEndpointConfig()).toBeNull();
	});

	test('returns config when fully configured', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const config = customEndpointConfig();
		expect(config).not.toBeNull();
		expect(config!.baseUrl).toBe('https://litellm.example.com/bedrock');
		expect(config!.token).toBe('sk-test');
	});

	test('falls back to module defaults when model IDs are not set', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		const config = customEndpointConfig()!;
		expect(config.opusModel).toBe('eu.anthropic.claude-opus-4-8');
		expect(config.sonnetModel).toBe('eu.anthropic.claude-sonnet-4-6');
		expect(config.defaultModel).toBe('opusplan');
	});

	test('respects custom model overrides', () => {
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		setOption('custom_endpoint_opus_model', 'my-custom-opus');
		const config = customEndpointConfig()!;
		expect(config.opusModel).toBe('my-custom-opus');
		setOption('custom_endpoint_opus_model', ''); // cleanup
	});
});

describe('git identity override', () => {
	beforeEach(() => {
		setOption('git_identity_enabled', '');
		setOption('git_identity_name', '');
		setOption('git_identity_email', '');
	});

	afterEach(() => {
		setOption('git_identity_enabled', '');
		setOption('git_identity_name', '');
		setOption('git_identity_email', '');
	});

	test('wins over host git config when both name and email are set', async () => {
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		const identity = await readGitIdentity();
		expect(identity).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
	});

	test('an explicit off toggle falls back to the host even with both fields set', async () => {
		setOption('git_identity_enabled', '0');
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		expect(gitIdentityEnabled()).toBe(false);
		const identity = await readGitIdentity();
		expect(identity?.name).not.toBe('Jane Doe');
	});

	test('the toggle defaults on when both fields are already filled', () => {
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		expect(gitIdentityEnabled()).toBe(true);
	});

	test('a lone name with no email is not treated as an override', async () => {
		setOption('git_identity_name', 'Jane Doe');
		const identity = await readGitIdentity();
		expect(identity?.name).not.toBe('Jane Doe');
	});

	test('a lone email with no name is not treated as an override', async () => {
		setOption('git_identity_email', 'jane@example.com');
		const identity = await readGitIdentity();
		expect(identity?.email).not.toBe('jane@example.com');
	});

	test('blank strings are treated the same as unset', async () => {
		setOption('git_identity_name', '  ');
		setOption('git_identity_email', '  ');
		const identity = await readGitIdentity();
		expect(identity?.name).not.toBe('  ');
	});

	test('auth.status() reports the Settings override as the source', async () => {
		setOption('git_identity_name', 'Jane Doe');
		setOption('git_identity_email', 'jane@example.com');
		const status = await gitIdentity.auth!.status();
		expect(status).toEqual({ available: true, source: 'Settings override — Jane Doe' });
	});
});

describe('manualModelConfig', () => {
	const MODEL_KEYS = [
		'manual_opus_model',
		'manual_sonnet_model',
		'manual_haiku_model',
		'manual_small_fast_model',
		'manual_model'
	];
	function reset() {
		setOption('manual_model_override_enabled', '0');
		setOption('custom_endpoint_enabled', '0');
		for (const k of MODEL_KEYS) setOption(k, '');
	}
	beforeEach(reset);
	afterEach(reset);

	test('returns null when the override is disabled', () => {
		setOption('manual_model', 'opus');
		expect(manualModelConfig()).toBeNull();
	});

	test('returns null when LiteLLM is enabled (mutually exclusive)', () => {
		setOption('manual_model_override_enabled', '1');
		setOption('custom_endpoint_enabled', '1');
		setOption('manual_model', 'opus');
		expect(manualModelConfig()).toBeNull();
	});

	test('returns null when enabled but every field is blank', () => {
		setOption('manual_model_override_enabled', '1');
		expect(manualModelConfig()).toBeNull();
	});

	test('exports only the filled fields, mapped to their env vars', () => {
		setOption('manual_model_override_enabled', '1');
		setOption('manual_model', 'opusplan');
		setOption('manual_small_fast_model', 'haiku');
		expect(manualModelConfig()).toEqual({
			ANTHROPIC_MODEL: 'opusplan',
			ANTHROPIC_SMALL_FAST_MODEL: 'haiku'
		});
	});

	test('maps all five tiers when fully filled', () => {
		setOption('manual_model_override_enabled', '1');
		setOption('manual_opus_model', 'o');
		setOption('manual_sonnet_model', 's');
		setOption('manual_haiku_model', 'h');
		setOption('manual_small_fast_model', 'sf');
		setOption('manual_model', 'd');
		expect(manualModelConfig()).toEqual({
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'o',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 's',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'h',
			ANTHROPIC_SMALL_FAST_MODEL: 'sf',
			ANTHROPIC_MODEL: 'd'
		});
	});
});

describe('hostClaudeModel', () => {
	function reset() {
		setOption('manual_model_override_enabled', '0');
		setOption('custom_endpoint_enabled', '0');
	}
	beforeEach(reset);
	afterEach(reset);

	test('is null when the manual model override owns the model', async () => {
		setOption('manual_model_override_enabled', '1');
		expect(await hostClaudeModel()).toBeNull();
	});

	test('is null when LiteLLM owns the model', async () => {
		setOption('custom_endpoint_enabled', '1');
		expect(await hostClaudeModel()).toBeNull();
	});
});

describe('NO_COAUTHOR_SETTINGS', () => {
	test('suppresses the byline via both the root and nested attribution schemas', () => {
		expect(NO_COAUTHOR_SETTINGS.includeCoAuthoredBy).toBe(false);
		expect(NO_COAUTHOR_SETTINGS.attribution).toEqual({
			commit: '',
			pr: '',
			includeCoAuthoredBy: false
		});
	});
});

describe('claudeTrustConfig', () => {
	test('always pre-accepts onboarding and the bypass-permissions warning at root', () => {
		const cfg = claudeTrustConfig(null);
		expect(cfg.hasCompletedOnboarding).toBe(true);
		expect(cfg.bypassPermissionsModeAccepted).toBe(true);
	});

	test('omits the projects block when no workspace path is known', () => {
		expect(claudeTrustConfig(null).projects).toBeUndefined();
	});

	test('pre-accepts the bypass warning in settings.json, where claude ≥2.1.220 keeps it', () => {
		expect(CLAUDE_TRUST_SETTINGS).toEqual({ skipDangerousModePermissionPrompt: true });
	});

	test('nests trust + MCP auto-accept under the workspace path', () => {
		const cfg = claudeTrustConfig('/workspaces/my-repo');
		expect(cfg.projects).toEqual({
			'/workspaces/my-repo': {
				hasTrustDialogAccepted: true,
				hasCompletedProjectOnboarding: true,
				enableAllProjectMcpServers: true
			}
		});
	});
});

describe('claude-code-models registry', () => {
	test('is present regardless of the custom-endpoint toggle (self-guards at apply time)', () => {
		setOption('custom_endpoint_enabled', '0');
		expect(resolveInjections().map((i) => i.id)).toContain('claude-code-models');
		setOption('custom_endpoint_enabled', '1');
		setOption('custom_endpoint_base_url', 'https://litellm.example.com/bedrock');
		setOption('custom_endpoint_token', 'sk-test');
		expect(resolveInjections().map((i) => i.id)).toContain('claude-code-models');
		setOption('custom_endpoint_enabled', '0');
		setOption('custom_endpoint_base_url', '');
		setOption('custom_endpoint_token', '');
	});

	test('carries no auth chip and no health check', () => {
		const models = injections.find((i) => i.id === 'claude-code-models');
		expect(models).toBeDefined();
		expect(models!.auth).toBeUndefined();
		expect(models!.check).toBeUndefined();
	});
});

describe('parseHostEnvVarNames', () => {
	test('returns an empty array for null/missing input', () => {
		expect(parseHostEnvVarNames(null)).toEqual([]);
	});

	test('returns an empty array for malformed JSON', () => {
		expect(parseHostEnvVarNames('not json')).toEqual([]);
	});

	test('drops non-string entries', () => {
		expect(parseHostEnvVarNames(JSON.stringify(['FOO', 123, null, 'BAR']))).toEqual(['FOO', 'BAR']);
	});

	test('parses a valid name list', () => {
		expect(parseHostEnvVarNames(JSON.stringify(['FOO', 'BAR']))).toEqual(['FOO', 'BAR']);
	});
});

describe('hostEnvVarPresence', () => {
	const TEST_VAR = 'CODEBAY_TEST_PRESENCE_VAR';

	afterEach(() => {
		delete Bun.env[TEST_VAR];
	});

	test('marks a name present when its host value is non-empty', () => {
		Bun.env[TEST_VAR] = 'hello';
		expect(hostEnvVarPresence([TEST_VAR])).toEqual({ [TEST_VAR]: true });
	});

	test('marks a name absent when unset', () => {
		delete Bun.env[TEST_VAR];
		expect(hostEnvVarPresence([TEST_VAR])).toEqual({ [TEST_VAR]: false });
	});

	test('returns one entry per requested name', () => {
		const missingVar = 'CODEBAY_TEST_PRESENCE_MISSING';
		Bun.env[TEST_VAR] = 'hello';
		expect(hostEnvVarPresence([TEST_VAR, missingVar])).toEqual({
			[TEST_VAR]: true,
			[missingVar]: false
		});
	});
});

describe('hostEnvVarsConfig', () => {
	const TEST_VAR = 'CODEBAY_TEST_HOST_ENV_VAR';

	beforeEach(() => {
		setOption('host_env_vars_enabled', '0');
		setOption('host_env_var_names', '[]');
		delete Bun.env[TEST_VAR];
	});

	afterEach(() => {
		setOption('host_env_vars_enabled', '0');
		setOption('host_env_var_names', '[]');
		delete Bun.env[TEST_VAR];
	});

	test('returns null when disabled', () => {
		Bun.env[TEST_VAR] = 'hello';
		setOption('host_env_var_names', JSON.stringify([TEST_VAR]));
		expect(hostEnvVarsConfig()).toBeNull();
	});

	test('returns null when enabled but no names configured', () => {
		setOption('host_env_vars_enabled', '1');
		expect(hostEnvVarsConfig()).toBeNull();
	});

	test('returns null when enabled but none of the configured names resolve on the host', () => {
		setOption('host_env_vars_enabled', '1');
		setOption('host_env_var_names', JSON.stringify([TEST_VAR]));
		expect(hostEnvVarsConfig()).toBeNull();
	});

	test('resolves a configured name that has a host value', () => {
		Bun.env[TEST_VAR] = 'hello';
		setOption('host_env_vars_enabled', '1');
		setOption('host_env_var_names', JSON.stringify([TEST_VAR]));
		const config = hostEnvVarsConfig();
		expect(config).not.toBeNull();
		expect(config!.resolved).toEqual([{ name: TEST_VAR, value: 'hello' }]);
		expect(config!.missing).toEqual([]);
	});

	test('reports unresolved names as missing without dropping resolved ones', () => {
		const missingVar = 'CODEBAY_TEST_MISSING_VAR';
		Bun.env[TEST_VAR] = 'hello';
		delete Bun.env[missingVar];
		setOption('host_env_vars_enabled', '1');
		setOption('host_env_var_names', JSON.stringify([TEST_VAR, missingVar]));
		const config = hostEnvVarsConfig()!;
		expect(config.resolved).toEqual([{ name: TEST_VAR, value: 'hello' }]);
		expect(config.missing).toEqual([missingVar]);
	});
});

describe('parseCustomEnvVars', () => {
	test('returns [] for null, malformed JSON, and non-arrays', () => {
		expect(parseCustomEnvVars(null)).toEqual([]);
		expect(parseCustomEnvVars('not json')).toEqual([]);
		expect(parseCustomEnvVars(JSON.stringify({ not: 'an array' }))).toEqual([]);
	});

	test('keeps well-formed entries and drops entries with a bad or missing name/value', () => {
		expect(
			parseCustomEnvVars(
				JSON.stringify([
					{ name: 'FOO', value: 'bar' },
					{ name: '1BAD', value: 'x' }, // name must not start with a digit
					{ name: 'NO_VALUE' }, // missing value
					{ value: 'no-name' }, // missing name
					{ name: 'BLANK', value: '' } // empty value is kept by the parse; config filters it
				])
			)
		).toEqual([
			{ name: 'FOO', value: 'bar' },
			{ name: 'BLANK', value: '' }
		]);
	});
});

describe('customEnvVarsConfig / customEnvVarValues', () => {
	beforeEach(() => {
		setOption('custom_env_vars_enabled', '0');
		setOption('custom_env_vars', '[]');
	});
	afterEach(() => {
		setOption('custom_env_vars_enabled', '0');
		setOption('custom_env_vars', '[]');
	});

	test('config is null when disabled, even with vars stored', () => {
		setOption('custom_env_vars', JSON.stringify([{ name: 'FOO', value: 'bar' }]));
		expect(customEnvVarsConfig()).toBeNull();
	});

	test('config is null when enabled but empty or all values blank', () => {
		setOption('custom_env_vars_enabled', '1');
		expect(customEnvVarsConfig()).toBeNull();
		setOption('custom_env_vars', JSON.stringify([{ name: 'FOO', value: '' }]));
		expect(customEnvVarsConfig()).toBeNull();
	});

	test('config returns only the non-empty vars when enabled', () => {
		setOption('custom_env_vars_enabled', '1');
		setOption(
			'custom_env_vars',
			JSON.stringify([
				{ name: 'FOO', value: 'bar' },
				{ name: 'EMPTY', value: '' }
			])
		);
		expect(customEnvVarsConfig()).toEqual({ vars: [{ name: 'FOO', value: 'bar' }] });
	});

	test('customEnvVarValues yields values only while enabled', () => {
		setOption('custom_env_vars', JSON.stringify([{ name: 'FOO', value: 'bar' }]));
		expect(customEnvVarValues()).toEqual([]);
		setOption('custom_env_vars_enabled', '1');
		expect(customEnvVarValues()).toEqual(['bar']);
	});
});

describe('parseGhHosts', () => {
	test('returns an empty array when hosts.yml is empty', () => {
		expect(parseGhHosts('')).toEqual([]);
	});

	test('parses a single host', () => {
		const raw = 'github.com:\n    oauth_token: gho_abc\n    git_protocol: https\n';
		expect(parseGhHosts(raw)).toEqual(['github.com']);
	});

	test('parses multiple hosts, including a GitHub Enterprise host', () => {
		const raw =
			'github.com:\n    oauth_token: gho_abc\n    git_protocol: https\n' +
			'schibsted.ghe.com:\n    oauth_token: gho_def\n    git_protocol: https\n    user: stanislav-khromov\n';
		expect(parseGhHosts(raw)).toEqual(['github.com', 'schibsted.ghe.com']);
	});

	test('does not mistake an indented key for a host', () => {
		const raw = 'github.com:\n    oauth_token: gho_abc\n';
		expect(parseGhHosts(raw)).toEqual(['github.com']);
	});
});

describe('ghHostBlock', () => {
	const raw =
		'github.com:\n    oauth_token: gho_abc\n    git_protocol: https\n    user: khromov\n' +
		'schibsted.ghe.com:\n    oauth_token: gho_def\n    git_protocol: ssh\n    user: stanislav-khromov\n';

	test('returns null for a host not present', () => {
		expect(ghHostBlock(raw, 'gitlab.example.com')).toBeNull();
	});

	test('extracts only the requested host block, not the next host', () => {
		const block = ghHostBlock(raw, 'github.com')!;
		expect(block).toContain('oauth_token: gho_abc');
		expect(block).toContain('user: khromov');
		expect(block).not.toContain('gho_def');
		expect(block).not.toContain('schibsted.ghe.com');
	});

	test('extracts the last host block through end of file', () => {
		const block = ghHostBlock(raw, 'schibsted.ghe.com')!;
		expect(block).toContain('oauth_token: gho_def');
		expect(block).toContain('git_protocol: ssh');
	});
});

describe('expandTilde', () => {
	test('expands a leading ~/ against the home directory', () => {
		expect(expandTilde('~/statusline.sh')).toBe(join(homedir(), 'statusline.sh'));
	});

	test('leaves absolute and non-tilde paths untouched', () => {
		expect(expandTilde('/abs/path')).toBe('/abs/path');
		expect(expandTilde('relative/path')).toBe('relative/path');
	});
});

describe('extractScriptPath', () => {
	test('returns null for a bare package-runner command with no file reference', () => {
		expect(extractScriptPath('npx ccstatusline@latest')).toBeNull();
	});

	test('returns null when the referenced path does not exist on disk', () => {
		expect(extractScriptPath('/no/such/file/statusline.sh')).toBeNull();
	});

	test('finds an existing absolute-path token amid other arguments', () => {
		// Use a file guaranteed to exist without depending on codebay-specific state.
		expect(extractScriptPath(`bash ${import.meta.path} --flag`)).toBe(import.meta.path);
	});

	// jq's `//` operator and a bare `/` resolve to the root dir with existsSync — but they're
	// not files, so an inline command must not be mistaken for a script-file reference.
	test('ignores jq operators and division in an inline command', () => {
		const inline =
			`input=$(cat); model=$(echo "$input" | jq -r '.model.display_name // "Unknown model"'); ` +
			`cost=$(echo "$input" | jq -r '(.cost.total_cost_usd // 0) | . * 100 | round / 100')`;
		expect(extractScriptPath(inline)).toBeNull();
	});

	test('ignores a root or directory token that is not a regular file', () => {
		expect(extractScriptPath('cat / done')).toBeNull();
		expect(extractScriptPath('x // y')).toBeNull();
	});

	test('returns null for a missing ~/ script path', () => {
		expect(extractScriptPath('~/definitely-missing-xyz.sh')).toBeNull();
	});
});

describe('claude-code-credentials isValid', () => {
	const oauth = (extra: Record<string, unknown>) =>
		JSON.stringify({ claudeAiOauth: { accessToken: 'tok', ...extra } });

	test('rejects malformed JSON', () => {
		expect(isValid('not json')).toBe(false);
	});

	test('rejects a missing access token', () => {
		expect(isValid(JSON.stringify({ claudeAiOauth: {} }))).toBe(false);
	});

	test('accepts a token with no expiry info at all', () => {
		expect(isValid(oauth({}))).toBe(true);
	});

	test('accepts an access token that has expired, as long as the refresh token has not', () => {
		expect(
			isValid(oauth({ expiresAt: Date.now() - 1000, refreshTokenExpiresAt: Date.now() + 1000 }))
		).toBe(true);
	});

	test('rejects once the refresh token itself has expired', () => {
		expect(
			isValid(oauth({ expiresAt: Date.now() + 1000, refreshTokenExpiresAt: Date.now() - 1000 }))
		).toBe(false);
	});

	test('falls back to the access token expiry when there is no refresh-token expiry', () => {
		expect(isValid(oauth({ expiresAt: Date.now() - 1000 }))).toBe(false);
		expect(isValid(oauth({ expiresAt: Date.now() + 1000 }))).toBe(true);
	});
});

describe('claude-code-credentials tokenCredentials', () => {
	const parse = (json: string) =>
		(JSON.parse(json) as { claudeAiOauth: { accessToken: string; scopes?: string[] } })
			.claudeAiOauth;

	test('carries the token through verbatim', () => {
		expect(parse(tokenCredentials('sk-ant-oat01-abc')).accessToken).toBe('sk-ant-oat01-abc');
	});

	// Without `scopes`, `claude` reports "Not logged in" however valid the token is.
	test('includes scopes, without which claude ignores the credentials', () => {
		const scopes = parse(tokenCredentials('sk-ant-oat01-abc')).scopes;
		expect(scopes).toBeDefined();
		expect(scopes).toContain('user:inference');
	});

	test('produces a record that passes isValid', () => {
		expect(isValid(tokenCredentials('sk-ant-oat01-abc'))).toBe(true);
	});
});

describe('claude-code-credentials LIVE_CREDENTIALS_TEST', () => {
	/** Run the injection's own shell predicate against a file, exactly as `check()` does. */
	function isLive(content: string | null): boolean {
		const dir = mkdtempSync(join(tmpdir(), 'codebay-creds-'));
		const file = join(dir, '.credentials.json');
		if (content !== null) writeFileSync(file, content);
		try {
			const res = Bun.spawnSync([
				'bash',
				'-c',
				`f="$1"; if ${LIVE_CREDENTIALS_TEST}; then echo 1; else echo 0; fi`,
				'bash',
				file
			]);
			return res.stdout.toString().trim() === '1';
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	/** The shape `claude` writes; blank tokens are what a rejected refresh leaves behind. */
	const credsFile = (accessToken: string, spaced = false) =>
		JSON.stringify(
			{
				claudeAiOauth: {
					accessToken,
					refreshToken: accessToken ? 'refresh' : '',
					expiresAt: accessToken ? Date.now() + 1000 : 0,
					scopes: ['user:inference'],
					subscriptionType: 'max'
				}
			},
			null,
			spaced ? 2 : undefined
		);

	test('accepts a file carrying a real access token', () => {
		expect(isLive(credsFile('sk-ant-oat-abc'))).toBe(true);
	});

	test('rejects the blanked file a rejected in-container refresh leaves behind', () => {
		expect(isLive(credsFile(''))).toBe(false);
	});

	test('rejects a missing or empty file', () => {
		expect(isLive(null)).toBe(false);
		expect(isLive('')).toBe(false);
	});

	test('reads the same either way when the file is pretty-printed', () => {
		expect(isLive(credsFile('sk-ant-oat-abc', true))).toBe(true);
		expect(isLive(credsFile('', true))).toBe(false);
	});

	test('is unfazed by tabs and CRLF line endings', () => {
		const crlf = (s: string) => s.replace(/\n/g, '\r\n').replace(/ {2}/g, '\t');
		expect(isLive(crlf(credsFile('sk-ant-oat-abc', true)))).toBe(true);
		expect(isLive(crlf(credsFile('', true)))).toBe(false);
	});

	// Ties the two halves together: whatever `tokenCredentials` injects must be what
	// the health check then reports as a live login, or a fresh container reads red.
	test('accepts the record tokenCredentials injects', () => {
		expect(isLive(tokenCredentials('sk-ant-oat01-abc'))).toBe(true);
	});
});

describe('code-server-dark', () => {
	// The real manifest's shape: `id` is the settingsId VS Code matches against, and the label is
	// an nls placeholder — which is exactly why the theme id must come from `id`, not the label.
	const manifest = () => ({
		contributes: {
			themes: [
				{ id: 'Light 2026', label: '%light2026%', uiTheme: 'vs', path: './themes/2026-light.json' },
				{
					id: 'Dark 2026',
					label: '%dark2026%',
					uiTheme: 'vs-dark',
					path: './themes/2026-dark.json'
				},
				{
					id: 'Light Modern',
					label: '%lightModern%',
					uiTheme: 'vs',
					path: './themes/light_modern.json'
				},
				{
					id: 'Dark Modern',
					label: '%darkModern%',
					uiTheme: 'vs-dark',
					path: './themes/dark_modern.json'
				},
				{ id: 'Default High Contrast', uiTheme: 'hc-black', path: './themes/hc_black.json' },
				{ id: 'Default High Contrast Light', uiTheme: 'hc-light', path: './themes/hc_light.json' }
			]
		}
	});

	test('repoints every light entry at a dark theme, high contrast included', () => {
		const { next, changed } = darkenThemeManifest(manifest());
		const themes = (next.contributes as { themes: { uiTheme: string; path: string }[] }).themes;
		expect(changed).toBe(3);
		expect(themes.every((t) => t.uiTheme === 'vs-dark' || t.uiTheme === 'hc-black')).toBe(true);
		// The light JSONs stay light on disk, so leaving `path` alone would keep them light.
		expect(themes.find((t) => t.path.includes('light'))).toBeUndefined();
		expect(themes[5]!.path).toBe('./themes/hc_black.json');
	});

	// A filename glob would match 2026-light/light_modern/light_plus/light_vs but miss hc_light.
	test('selects by uiTheme, not by filename', () => {
		const odd = {
			contributes: {
				themes: [
					{ id: 'Dark', uiTheme: 'vs-dark', path: './themes/dark_modern.json' },
					{ id: 'Solarized', uiTheme: 'vs', path: './themes/solarized.json' }
				]
			}
		};
		const themes = (darkenThemeManifest(odd).next.contributes as { themes: { uiTheme: string }[] })
			.themes;
		expect(themes[1]!.uiTheme).toBe('vs-dark');
	});

	test('is idempotent — a second pass changes nothing', () => {
		const once = darkenThemeManifest(manifest()).next;
		expect(darkenThemeManifest(once).changed).toBe(0);
	});

	test('leaves a manifest it does not recognise alone', () => {
		expect(darkenThemeManifest({}).changed).toBe(0);
		expect(darkenThemeManifest({ contributes: {} }).changed).toBe(0);
		expect(darkenThemeManifest({ contributes: { themes: 'nope' } }).changed).toBe(0);
	});

	// VS Code resolves settingsId as `theme.id || label`, so pinning the nls label would break on
	// any build where the two differ — which is precisely the `Default Dark Modern` era.
	test('pins the manifest id, preferring the build default, never the label', () => {
		expect(pickDarkThemeId(manifest())).toBe('Dark 2026');
		const older = {
			contributes: {
				themes: [
					{ id: 'Dark Modern', label: 'Default Dark Modern', uiTheme: 'vs-dark', path: './d.json' }
				]
			}
		};
		expect(pickDarkThemeId(older)).toBe('Dark Modern');
	});

	test('falls back to whatever dark theme the build ships, and to null when there is none', () => {
		const exotic = {
			contributes: { themes: [{ id: 'Monokai', uiTheme: 'vs-dark', path: './m.json' }] }
		};
		expect(pickDarkThemeId(exotic)).toBe('Monokai');
		// Writing a made-up id would be worse than leaving the staged settings alone.
		expect(
			pickDarkThemeId({ contributes: { themes: [{ id: 'L', uiTheme: 'vs', path: './l.json' }] } })
		).toBe(null);
		expect(pickDarkThemeId({})).toBe(null);
	});

	// Run the scripts against a real temp tree, exactly as they would run in a container. The stub
	// must be executable or `command -v` skips it — and on a box that has a real code-server (this
	// repo dogfoods itself) it would then resolve that one instead.
	function stubbedRun(root: string, script: string): string {
		const bin = join(root, 'bin');
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, 'code-server'), '#!/bin/sh\n', { mode: 0o755 });
		const res = Bun.spawnSync(['bash', '-c', `PATH="${bin}:$PATH"; ${script}`]);
		return res.stdout.toString().trimEnd().split('\n').pop()?.trim() ?? '';
	}

	test('finds the bundled VS Code in both install layouts', () => {
		// realpath: macOS resolves /var -> /private/var, which `readlink -f` in the script follows.
		const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cs-dark-')));
		try {
			// Standalone: bin/ sits directly under the root that holds lib/vscode.
			const standalone = join(tmp, 'standalone');
			mkdirSync(join(standalone, 'lib', 'vscode', 'extensions', 'theme-defaults'), {
				recursive: true
			});
			expect(stubbedRun(standalone, RESOLVE_ROOT_SCRIPT)).toBe(join(standalone, 'lib', 'vscode'));

			// Flat: the bundled tree is the root itself.
			const flat = join(tmp, 'flat');
			mkdirSync(join(flat, 'extensions', 'theme-defaults'), { recursive: true });
			expect(stubbedRun(flat, RESOLVE_ROOT_SCRIPT)).toBe(flat);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test('resolves nothing when no bundled VS Code is present', () => {
		const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cs-dark-none-')));
		try {
			expect(stubbedRun(join(tmp, 'bare'), RESOLVE_ROOT_SCRIPT)).toBe('');
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	// One exec, because this runs on every health tick alongside the iframe-gating probe.
	test('check script resolves and probes in a single pass', () => {
		const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cs-dark-check-')));
		try {
			const dir = join(tmp, 'lib', 'vscode', 'extensions', 'theme-defaults');
			mkdirSync(dir, { recursive: true });
			const run = () => stubbedRun(tmp, DARK_CHECK_SCRIPT);

			writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest(), null, 2));
			expect(run()).toBe('0');

			// code-server ships this file minified, so a fixed-spacing pattern would miss the
			// unpatched manifest entirely and report the injection as already applied.
			writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest()));
			expect(run()).toBe('0');

			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify(darkenThemeManifest(manifest()).next, null, 2)
			);
			expect(run()).toBe('1');
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test('check script reports 0 when there is no code-server at all', () => {
		const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cs-dark-nocs-')));
		try {
			expect(stubbedRun(join(tmp, 'bare'), DARK_CHECK_SCRIPT)).toBe('0');
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
