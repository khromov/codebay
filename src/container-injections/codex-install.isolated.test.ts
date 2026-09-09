import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { COMPLETE_INSTALL_TEST, INSTALL_SCRIPT } from './codex-install.ts';

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-codex-package-'));
	dirs.push(dir);
	const home = join(dir, 'home');
	const bin = join(dir, 'bin');
	const payload = join(dir, 'payload');
	const archive = join(dir, 'package.tar.gz');
	function file(path: string, text: string, executable = true) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text, { mode: executable ? 0o755 : 0o644 });
	}
	const cli = '#!/bin/sh\necho "codex-cli 0.153.4"\n';
	file(join(home, '.local/bin/codex'), cli);
	file(join(payload, 'bin/codex'), cli);
	for (const path of [
		'bin/codex-code-mode-host',
		'codex-path/rg',
		'codex-resources/bwrap',
		'codex-resources/zsh/bin/zsh'
	])
		file(join(payload, path), '#!/bin/sh\nexit 0\n');
	file(join(payload, 'codex-package.json'), '{"layoutVersion":1,"version":"0.153.4"}', false);
	file(
		join(bin, 'getent'),
		'#!/bin/sh\nprintf "node:x:1000:1000::%s:/bin/sh\\n" "$TEST_CODEX_HOME"\n'
	);
	file(join(bin, 'uname'), '#!/bin/sh\necho aarch64\n');
	file(join(bin, 'chown'), '#!/bin/sh\nexit 0\n');
	file(
		join(bin, 'curl'),
		'#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_CODEX_DOWNLOADS"\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then cp "$TEST_CODEX_ARCHIVE" "$2"; exit $?; fi; shift; done\nexit 1\n'
	);
	const env = {
		...process.env,
		PATH: `${bin}:${home}/.local/bin:${process.env.PATH}`,
		TEST_CODEX_HOME: home,
		TEST_CODEX_DOWNLOADS: join(dir, 'downloads'),
		TEST_CODEX_ARCHIVE: archive,
		CODEBAY_CODEX_VERSION: '0.153.4',
		CODEBAY_CODEX_UPDATE: '1'
	};
	const pack = () =>
		expect(Bun.spawnSync(['tar', '-czf', archive, '-C', payload, '.']).exitCode).toBe(0);
	pack();
	const run = (script: string) =>
		Bun.spawnSync(
			['bash', '-c', script.replaceAll('/usr/local/bin/', `${bin}/`), 'codex-install', 'node'],
			{ env }
		);
	return { dir, home, payload, pack, run };
}

describe.skipIf(process.platform === 'win32')('Codex native package installation', () => {
	test('repairs a same-version standalone binary and skips subsequent complete installs', () => {
		const f = fixture();
		expect(f.run(COMPLETE_INSTALL_TEST).exitCode).not.toBe(0);
		const installed = f.run(INSTALL_SCRIPT);
		expect(installed.stderr.toString()).toBe('');
		expect(installed.exitCode).toBe(0);
		expect(f.run(COMPLETE_INSTALL_TEST).exitCode).toBe(0);
		const executable = realpathSync(join(f.home, '.local/bin/codex'));
		expect(executable).toContain('/release.');
		expect(f.run(INSTALL_SCRIPT).exitCode).toBe(0);
		expect(readFileSync(join(f.dir, 'downloads'), 'utf8').trim().split('\n')).toHaveLength(1);
		expect(readFileSync(join(f.dir, 'downloads'), 'utf8')).toContain(
			'rust-v0.153.4/codex-package-aarch64-unknown-linux-musl.tar.gz'
		);
		rmSync(join(dirname(executable), 'codex-code-mode-host'));
		expect(f.run(COMPLETE_INSTALL_TEST).exitCode).not.toBe(0);
		expect(f.run(INSTALL_SCRIPT).exitCode).toBe(0);
		expect(f.run(COMPLETE_INSTALL_TEST).exitCode).toBe(0);
	});

	test('an incomplete release does not replace the existing executable', () => {
		const f = fixture();
		const before = readFileSync(join(f.home, '.local/bin/codex'), 'utf8');
		rmSync(join(f.payload, 'bin/codex-code-mode-host'));
		f.pack();
		expect(f.run(INSTALL_SCRIPT).exitCode).not.toBe(0);
		expect(readFileSync(join(f.home, '.local/bin/codex'), 'utf8')).toBe(before);
	});
});
