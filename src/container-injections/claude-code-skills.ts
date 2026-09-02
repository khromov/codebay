import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { checkPresence } from '../lib/exec.server.ts';
import { writeContainerFileBytes } from '../lib/container-files.server.ts';
import { claudeConfigFile } from '../lib/claude-settings.server.ts';
import { hostClaudeFile } from '../lib/host-claude.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * The env-var stdin carrier caps a single write near 128 KB (Linux `MAX_ARG_STRLEN`); base64
 * inflates ~4/3, so a raw file over this is skipped rather than failing the whole injection.
 */
const MAX_FILE_BYTES = 90_000;

interface HostFile {
	/** Path relative to the host Claude dir, e.g. `CLAUDE.md` or `skills/foo/SKILL.md`. */
	rel: string;
	bytes: Buffer;
	/** True when any execute bit is set on the host, so container scripts stay runnable. */
	exec: boolean;
	oversized: boolean;
}

/** Recursively lists every file under a host dir, as `skills/<subpath>` entries. */
async function walkSkills(dir: string, rel: string, out: HostFile[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = posix.join(dir, entry.name);
		const childRel = posix.join(rel, entry.name);
		if (entry.isDirectory()) {
			await walkSkills(abs, childRel, out);
		} else if (entry.isFile()) {
			const info = await stat(abs);
			out.push({
				rel: childRel,
				bytes: info.size > MAX_FILE_BYTES ? Buffer.alloc(0) : await readFile(abs),
				exec: (info.mode & 0o111) !== 0,
				oversized: info.size > MAX_FILE_BYTES
			});
		}
	}
}

/** Cheap presence probe for the setup-UI chip — never reads file contents. */
export async function hasHostSkillFiles(): Promise<boolean> {
	if (existsSync(hostClaudeFile('CLAUDE.md'))) return true;
	try {
		return (await readdir(hostClaudeFile('skills'))).length > 0;
	} catch {
		return false;
	}
}

/** The host global CLAUDE.md plus every file under the host skills dir. */
export async function collectHostSkillFiles(): Promise<HostFile[]> {
	const files: HostFile[] = [];
	const claudeMd = hostClaudeFile('CLAUDE.md');
	if (existsSync(claudeMd)) {
		const info = await stat(claudeMd);
		if (info.isFile()) {
			files.push({
				rel: 'CLAUDE.md',
				bytes: info.size > MAX_FILE_BYTES ? Buffer.alloc(0) : await readFile(claudeMd),
				exec: false,
				oversized: info.size > MAX_FILE_BYTES
			});
		}
	}
	await walkSkills(hostClaudeFile('skills'), 'skills', files);
	return files;
}

export const claudeCodeSkills: Injection = {
	id: 'claude-code-skills',
	label: 'skills & CLAUDE.md',

	auth: {
		hint: 'add skills or a CLAUDE.md to your host ~/.claude',
		async status() {
			const available = await hasHostSkillFiles();
			return { available, source: available ? '~/.claude' : null };
		}
	},

	async apply(target, log) {
		const files = await collectHostSkillFiles();
		if (!files.length) {
			log('⚠ No global skills or CLAUDE.md found on host; skipped\n');
			return;
		}
		log(`Injecting ${files.length} global skill/CLAUDE.md file(s)…\n`);
		let failed = 0;
		for (const file of files) {
			if (file.oversized) {
				log(`⚠ Skipped ${file.rel} (larger than ${MAX_FILE_BYTES} bytes)\n`);
				continue;
			}
			const dest = claudeConfigFile(file.rel, file.exec ? '755' : '644');
			const wrote = await writeContainerFileBytes(target, dest, file.bytes);
			if (!wrote.ok) {
				failed++;
				log(`⚠ Failed to write ${file.rel}: ${wrote.error}\n`);
			}
		}
		log(
			failed
				? `⚠ ${failed} skill file(s) failed to inject\n`
				: '✓ Global skills & CLAUDE.md injected\n'
		);
	},

	async check(target) {
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
				'if [ -s "$d/CLAUDE.md" ] || [ -n "$(ls -A "$d/skills" 2>/dev/null)" ]; then echo 1; else echo 0; fi'
		);
	}
};
