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
export const MAX_FILE_BYTES = 90_000;

interface HostFile {
	/** Path relative to the host Claude dir, e.g. `CLAUDE.md` or `skills/foo/SKILL.md`. */
	rel: string;
	bytes: Buffer;
	/** True when any execute bit is set on the host, so container scripts stay runnable. */
	exec: boolean;
	oversized: boolean;
}

async function readHostFile(abs: string, rel: string): Promise<HostFile> {
	const info = await stat(abs);
	const oversized = info.size > MAX_FILE_BYTES;
	return {
		rel,
		bytes: oversized ? Buffer.alloc(0) : await readFile(abs),
		exec: (info.mode & 0o111) !== 0,
		oversized
	};
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
		if (rel === 'skills' && SYNC_BOOKKEEPING_DIRS.has(entry.name)) continue;
		if (rel === 'skills' && entry.name === SYNCED_DIR && entry.isDirectory()) {
			await walkSynced(abs, childRel, out);
		} else if (entry.isDirectory()) {
			await walkSkills(abs, childRel, out);
		} else if (entry.isFile()) {
			out.push(await readHostFile(abs, childRel));
		}
	}
}

/** Claude Code's claude.ai skill sync root, split into one `<org>_<account>` bucket per login. */
const SYNCED_DIR = 'synced';
/** The sync's own staging and trash under `skills/` — never skills the user runs. */
const SYNC_BOOKKEEPING_DIRS = new Set(['.staging', '.trash']);
const BUCKET_MARKER_PREFIX = '.bucket-';

interface SyncedSkillEntry {
	skillId?: unknown;
	name?: unknown;
	source?: unknown;
	creatorType?: unknown;
}

/** Claude Code 2.1.283's manifests carry only `source`; `creatorType` is honoured if one ever appears. */
export function isAnthropicSkill(entry: SyncedSkillEntry): boolean {
	if (entry.creatorType !== undefined) return entry.creatorType === 'anthropic';
	return typeof entry.source === 'string' && entry.source.startsWith('anthropic');
}

/** Folds a name the way Claude Code compares synced dir names, so case and Unicode form don't matter. */
const foldDirName = (name: string): string =>
	name
		.replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '')
		.normalize('NFD')
		.toLowerCase();

/** The dir Claude Code lands a synced skill in: its `name` with path-hostile characters replaced. */
export function syncedSkillDir(name: string): string {
	return name.replace(/[<>:"|?*\\/]/g, '_').replace(/[. ]+$/, '');
}

/**
 * Copies a sync bucket minus Anthropic's own skills, which the sandbox's Claude Code re-syncs for the
 * same login anyway. The manifest is rewritten to exactly the dirs copied (Claude Code reads it to
 * decide which dirs it owns), and a bucket with nothing left — or no readable manifest to judge
 * authorship by — is dropped whole, marker included.
 */
async function walkSyncedBucket(dir: string, rel: string, out: HostFile[]): Promise<boolean> {
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(await readFile(posix.join(dir, 'manifest.json'), 'utf8'));
	} catch {
		return false;
	}
	if (!Array.isArray(manifest?.skills)) return false;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return false;
	}
	const dirs = new Map(
		entries.filter((e) => e.isDirectory()).map((e) => [foldDirName(e.name), e.name])
	);
	const kept: { row: SyncedSkillEntry; dir: string }[] = [];
	for (const row of manifest.skills as unknown[]) {
		if (typeof row !== 'object' || row === null) continue;
		const entry = row as SyncedSkillEntry;
		if (typeof entry.name !== 'string' || isAnthropicSkill(entry)) continue;
		const found = dirs.get(foldDirName(syncedSkillDir(entry.name)));
		if (found !== undefined && !kept.some((k) => k.dir === found))
			kept.push({ row: entry, dir: found });
	}
	if (!kept.length) return false;
	for (const { dir: name } of kept) {
		await walkSkills(posix.join(dir, name), posix.join(rel, name), out);
	}
	// `staleDirs`/`pendingClaims` name host dirs and host PIDs, so neither means anything in the sandbox.
	const { staleDirs: _stale, pendingClaims: _pending, ...rest } = manifest;
	out.push({
		rel: posix.join(rel, 'manifest.json'),
		bytes: Buffer.from(JSON.stringify({ ...rest, skills: kept.map((k) => k.row) }, null, 2)),
		exec: false,
		oversized: false
	});
	return true;
}

async function walkSynced(dir: string, rel: string, out: HostFile[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		const bucketRel = posix.join(rel, entry.name);
		if (!(await walkSyncedBucket(posix.join(dir, entry.name), bucketRel, out))) continue;
		const marker = entries.find(
			(e) => e.isFile() && e.name === `${BUCKET_MARKER_PREFIX}${entry.name}`
		);
		if (marker)
			out.push(await readHostFile(posix.join(dir, marker.name), posix.join(rel, marker.name)));
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
		if ((await stat(claudeMd)).isFile()) {
			files.push({ ...(await readHostFile(claudeMd, 'CLAUDE.md')), exec: false });
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
		const skipped = files.filter((f) => f.oversized).map((f) => f.rel);
		if (skipped.length) {
			log(
				`⚠ Skipped ${skipped.length} file(s) larger than ${MAX_FILE_BYTES} bytes: ${skipped.join(', ')}\n`
			);
		}
		for (const file of files) {
			if (file.oversized) continue;
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
