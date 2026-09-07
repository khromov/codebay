import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binShim, devcontainerBin } from './config.server.ts';
import { spawnCapture } from './spawn.server.ts';

const WINDOWS = process.platform === 'win32';

describe('binShim', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'codebay-shim-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test('picks the name the running platform can actually spawn', () => {
		// A real Windows .bin holds all three: npm's extensionless POSIX sh script (unspawnable
		// there), Bun's .bunx data file, and the .exe that actually runs.
		writeFileSync(join(dir, 'devcontainer'), '#!/usr/bin/env node\n');
		writeFileSync(join(dir, 'devcontainer.bunx'), 'not an executable');
		writeFileSync(join(dir, 'devcontainer.exe'), 'binary');

		expect(binShim(dir, 'devcontainer')).toBe(
			join(dir, WINDOWS ? 'devcontainer.exe' : 'devcontainer')
		);
	});

	test('never selects the .bunx sibling, which throws EFTYPE when spawned', () => {
		writeFileSync(join(dir, 'devcontainer.bunx'), 'not an executable');
		expect(binShim(dir, 'devcontainer')).toBeNull();
	});

	test('returns null rather than a path that does not exist, so callers can fall back', () => {
		expect(binShim(dir, 'devcontainer')).toBeNull();
	});
});

describe('devcontainerBin', () => {
	// The regression guard for the whole preflight banner: this used to resolve to a bare
	// `devcontainer.js`, which Windows cannot exec, and the failure was swallowed as "not installed".
	test('resolves to an argv that actually runs the CLI', async () => {
		const version = await spawnCapture([...devcontainerBin(), '--version']);
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
	});
});
