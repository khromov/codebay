import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { BYTES_CHUNK_SIZE, writeContainerFileBytes } from './container-files.server.ts';
import { EXEC_STDIN_MAX_BYTES } from './exec.server.ts';

const g = globalThis as unknown as { __codebayDocker?: Promise<unknown> };

afterEach(() => {
	g.__codebayDocker = undefined;
});

/** Runs each exec's script in a local bash, so the chunked write is exercised end-to-end without a daemon. */
function localDocker(failOnCall?: number) {
	const stdinSizes: number[] = [];
	const container = {
		exec: async (cfg: { Cmd: string[]; Env?: string[] }) => {
			const env: Record<string, string> = { ...(process.env as Record<string, string>) };
			for (const entry of cfg.Env ?? []) {
				const eq = entry.indexOf('=');
				env[entry.slice(0, eq)] = entry.slice(eq + 1);
				stdinSizes.push(entry.length - eq - 1);
			}
			const failed = stdinSizes.length === failOnCall;
			const res = failed
				? { exitCode: 1 }
				: Bun.spawnSync(['bash', '-c', cfg.Cmd[2]!, ...cfg.Cmd.slice(3)], { env });
			return {
				start: async () => {
					const s = new PassThrough();
					queueMicrotask(() => s.end());
					return s;
				},
				modem: {
					demuxStream: (s: PassThrough) => s.resume()
				},
				inspect: async () => ({ ExitCode: res.exitCode })
			};
		}
	};
	g.__codebayDocker = Promise.resolve({ getContainer: () => container });
	return stdinSizes;
}

function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), 'codebay-bytes-'));
	return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const randomBytes = (n: number): Buffer =>
	Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));

describe('writeContainerFileBytes', () => {
	test('a small file goes in one exec', () =>
		withTmp(async (dir) => {
			const sizes = localDocker();
			const bytes = randomBytes(1000);
			const res = await writeContainerFileBytes(
				{ containerId: 'c' },
				{ dir, name: 'a.bin' },
				bytes
			);
			expect(res.ok).toBe(true);
			expect(sizes).toHaveLength(1);
			expect(readFileSync(join(dir, 'a.bin')).equals(bytes)).toBe(true);
		}));

	test('a file past the exec carrier cap is chunked and reassembled byte-for-byte', () =>
		withTmp(async (dir) => {
			const sizes = localDocker();
			const bytes = randomBytes(BYTES_CHUNK_SIZE * 2 + 17);
			const res = await writeContainerFileBytes(
				{ containerId: 'c' },
				{ dir: `${dir}/nested`, name: 'wml.xsd', mode: '755' },
				bytes
			);
			expect(res.ok).toBe(true);
			expect(sizes).toHaveLength(3);
			for (const size of sizes) expect(size).toBeLessThanOrEqual(EXEC_STDIN_MAX_BYTES);
			const out = join(dir, 'nested/wml.xsd');
			expect(readFileSync(out).equals(bytes)).toBe(true);
			expect(statSync(out).mode & 0o777).toBe(0o755);
			expect(existsSync(`${out}.codebay-part`)).toBe(false);
		}));

	test('a failed chunk reports an error and never leaves a truncated file in place', () =>
		withTmp(async (dir) => {
			localDocker(2);
			const res = await writeContainerFileBytes(
				{ containerId: 'c' },
				{ dir, name: 'big.bin' },
				randomBytes(BYTES_CHUNK_SIZE * 3)
			);
			expect(res.ok).toBe(false);
			expect(existsSync(join(dir, 'big.bin'))).toBe(false);
		}));
});
