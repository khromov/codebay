import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hostCodexDir } from '../lib/host-codex.server.ts';
import { codexConfigFile } from '../lib/codex-settings.server.ts';
import { writeContainerFileBytes, writeContainerFile } from '../lib/container-files.server.ts';
import { checkPresence } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

const MAX_FILE_BYTES = 90_000;
export async function collectCodexFiles() {
	const files: { name: string; bytes: Buffer; executable: boolean; oversized: boolean }[] = [];
	const visited = new Set<string>();
	async function walk(path: string, name: string) {
		try {
			const info = await stat(path);
			if (info.isDirectory()) {
				const real = await realpath(path);
				if (visited.has(real)) return;
				visited.add(real);
				for (const entry of await readdir(path)) await walk(join(path, entry), `${name}/${entry}`);
			} else if (info.isFile())
				files.push({
					name,
					bytes: info.size > MAX_FILE_BYTES ? Buffer.alloc(0) : await readFile(path),
					executable: !!(info.mode & 0o111),
					oversized: info.size > MAX_FILE_BYTES
				});
		} catch {
			/* Missing optional instructions and broken symlinks do not prevent startup. */
		}
	}
	const dir = hostCodexDir();
	await walk(join(dir, 'AGENTS.md'), 'AGENTS.md');
	await walk(join(dir, 'AGENTS.override.md'), 'AGENTS.override.md');
	await walk(join(dir, 'skills'), 'skills');
	await walk(join(homedir(), '.agents', 'skills'), 'skills');
	await walk(join(dir, 'rules'), 'rules');
	return files;
}

export const codexSkills: Injection = {
	id: 'codex-skills',
	label: 'Codex skills, rules & AGENTS.md',
	async apply(target, log) {
		const files = await collectCodexFiles();
		for (const file of files) {
			if (file.oversized) {
				log(`⚠ Skipped Codex ${file.name} (larger than ${MAX_FILE_BYTES} bytes)\n`);
				continue;
			}
			const result = await writeContainerFileBytes(
				target,
				codexConfigFile(file.name, file.executable ? '755' : '644'),
				file.bytes
			);
			if (!result.ok) log(`⚠ Could not inject Codex ${file.name}: ${result.error}\n`);
		}
		// AGENTS.override.md takes precedence over AGENTS.md, so append the container default to the active file.
		const active =
			files.find((f) => f.name === 'AGENTS.override.md' && !f.oversized) ??
			files.find((f) => f.name === 'AGENTS.md' && !f.oversized);
		const result = await writeContainerFile(
			target,
			codexConfigFile(active?.name ?? 'AGENTS.md', '644'),
			`${active?.bytes.toString('utf8') ?? ''}\n\nDo not add agent co-author trailers or attribution footers to commits or pull requests.\n`
		);
		log(
			result.ok
				? '✓ Codex instructions, skills and rules injected\n'
				: `⚠ Codex instructions injection failed: ${result.error}\n`
		);
	},
	check: (target) =>
		checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CODEX_HOME:-$h/.codex}"; test -s "$d/AGENTS.md" || test -s "$d/AGENTS.override.md"; [ "$?" = 0 ] && echo 1 || echo 0'
		)
};
