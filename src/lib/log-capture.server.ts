import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './config.server.ts';
import { getInstance, type InstanceRow } from './db.server.ts';
import { isRunning } from './docker.server.ts';
import { execInContainer } from './exec.server.ts';

/** Delta pulls are cheap, so a lazier cadence than the 5s health probe is plenty. */
const CAPTURE_MS = 10_000;

const MANIFEST_MARKER = '__CODEBAY_MANIFEST__';
const FETCH_MARKER = '__CODEBAY_FETCH__';
const FILE_MARKER = '__CODEBAY_FILE__';
const END_MARKER = '__CODEBAY_END__';

export interface ManifestEntry {
	path: string;
	size: number;
}

interface FetchJob {
	path: string;
	hostFileName: string;
	/** 1-indexed byte to `tail -c +N` from; 1 re-pulls the whole file. */
	startByte: number;
	mode: 'append' | 'rollover';
}

/**
 * Lists the transcript + history files with their byte sizes. `find`/`wc -c` (not GNU `-printf`)
 * so it works on busybox containers too; the marker line lets the parser skip login-shell noise.
 */
function manifestScript(): string {
	return (
		`h=$(eval echo ~$(id -un)); cfg="\${CLAUDE_CONFIG_DIR:-$h/.claude}"; ` +
		`printf '%s\\n' '${MANIFEST_MARKER}'; ` +
		`{ find "$cfg" -maxdepth 1 -type f -name 'history.jsonl' 2>/dev/null; ` +
		`find "$cfg/projects" -type f -name '*.jsonl' 2>/dev/null; } | ` +
		`while IFS= read -r f; do printf '%s\\t%s\\n' "$f" "$(wc -c < "$f" | tr -d ' ')"; done; true`
	);
}

/** Emits, per requested file, a framed block of base64 bytes from `startByte` to EOF. */
function fetchScript(): string {
	return (
		`printf '%s\\n' '${FETCH_MARKER}'; ` +
		`while [ "$#" -ge 2 ]; do p="$1"; o="$2"; shift 2; ` +
		`printf '${FILE_MARKER}\\t%s\\n' "$p"; ` +
		`tail -c "+$o" "$p" 2>/dev/null | base64; ` +
		`printf '\\n${END_MARKER}\\n'; done`
	);
}

export function parseManifest(stdout: string): ManifestEntry[] {
	const at = stdout.indexOf(MANIFEST_MARKER);
	if (at === -1) return [];
	const out: ManifestEntry[] = [];
	for (const line of stdout.slice(at + MANIFEST_MARKER.length).split('\n')) {
		const tab = line.indexOf('\t');
		if (tab === -1) continue;
		const path = line.slice(0, tab);
		const size = Number(line.slice(tab + 1).trim());
		if (path && Number.isFinite(size)) out.push({ path, size });
	}
	return out;
}

/** A `/projects/` path is a session transcript; the only other file we list is `history.jsonl`. */
export function hostFileNameFor(instanceId: string, containerPath: string): string {
	const base = containerPath.split('/').pop() ?? containerPath;
	if (containerPath.includes('/projects/')) {
		return `transcript-${instanceId}-${base.replace(/\.jsonl$/, '')}.jsonl`;
	}
	return `history-${instanceId}.jsonl`;
}

/** Diffs container sizes against the host mirrors: append new bytes, or re-pull a file that shrank. */
export function planFetch(
	instanceId: string,
	manifest: ManifestEntry[],
	hostSize: (hostFileName: string) => number
): FetchJob[] {
	const jobs: FetchJob[] = [];
	for (const { path, size } of manifest) {
		const hostFileName = hostFileNameFor(instanceId, path);
		const existing = hostSize(hostFileName);
		if (size === existing) continue;
		if (size < existing) jobs.push({ path, hostFileName, startByte: 1, mode: 'rollover' });
		else jobs.push({ path, hostFileName, startByte: existing + 1, mode: 'append' });
	}
	return jobs;
}

export function parseFetchBlocks(stdout: string): { path: string; base64: string }[] {
	const at = stdout.indexOf(FETCH_MARKER);
	if (at === -1) return [];
	const blocks: { path: string; base64: string }[] = [];
	for (const part of stdout
		.slice(at + FETCH_MARKER.length)
		.split(FILE_MARKER)
		.slice(1)) {
		const end = part.indexOf(END_MARKER);
		const seg = end === -1 ? part : part.slice(0, end);
		const nl = seg.indexOf('\n');
		if (nl === -1) continue;
		const path = seg.slice(0, nl).replace(/^\t/, '');
		// base64 wrapping (GNU wraps at 76 cols) is stripped so multi-line blocks decode cleanly.
		blocks.push({ path, base64: seg.slice(nl + 1).replace(/\s+/g, '') });
	}
	return blocks;
}

function sizeOnDisk(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

/**
 * A rebuild recreates the container (`--remove-existing-container`), so its `~/.claude` starts empty
 * and the next manifest reports a file smaller than our mirror. Archiving the mirror aside — rather
 * than overwriting it with the new container's few hundred bytes — is what makes retention real.
 */
function rollOver(dest: string): void {
	if (!existsSync(dest)) return;
	const dot = dest.lastIndexOf('.');
	const stem = dot === -1 ? dest : dest.slice(0, dot);
	const ext = dot === -1 ? '' : dest.slice(dot);
	for (let n = 1; ; n++) {
		const archive = `${stem}.${n}${ext}`;
		if (existsSync(archive)) continue;
		renameSync(dest, archive);
		return;
	}
}

/** Keeps `index.json` mapping the opaque UUID filenames back to a human-readable instance. */
function updateIndex(logsDir: string, row: InstanceRow): void {
	const indexPath = join(logsDir, 'index.json');
	let index: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
		if (parsed && typeof parsed === 'object') index = parsed as Record<string, unknown>;
	} catch {
		// Absent or corrupt — start fresh rather than lose this pass.
	}
	index[row.id] = {
		name: row.name,
		source_path: row.source_path,
		created_at: row.created_at,
		last_captured: Date.now()
	};
	writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

interface CaptureDeps {
	exec?: typeof execInContainer;
	logsDir?: string;
}

/**
 * One extraction pass: manifest → plan deltas → fetch → append/roll over host mirrors → index.
 * Resolves false when the container could not be read, which is how `tick` detects a dead chain.
 */
export async function runCapturePass(row: InstanceRow, deps: CaptureDeps = {}): Promise<boolean> {
	if (!row.container_id) return false;
	const exec = deps.exec ?? execInContainer;
	const logsDir = deps.logsDir ?? LOGS_DIR;
	const target = { containerId: row.container_id, remoteUser: row.remote_user };

	const manifestRes = await exec(target, { script: manifestScript(), capture: true });
	if (!manifestRes.ok) return false;
	const manifest = parseManifest(manifestRes.stdout);

	mkdirSync(logsDir, { recursive: true });
	const jobs = planFetch(row.id, manifest, (name) => sizeOnDisk(join(logsDir, name)));

	if (jobs.length) {
		const args = ['fetch'];
		for (const j of jobs) args.push(j.path, String(j.startByte));
		const fetchRes = await exec(target, { script: fetchScript(), args, capture: true });
		if (fetchRes.ok) {
			const byPath = new Map(jobs.map((j) => [j.path, j]));
			for (const block of parseFetchBlocks(fetchRes.stdout)) {
				const job = byPath.get(block.path);
				if (!job) continue;
				const bytes = Buffer.from(block.base64, 'base64');
				const dest = join(logsDir, job.hostFileName);
				if (job.mode === 'rollover') rollOver(dest);
				appendFileSync(dest, bytes);
			}
		}
	}
	updateIndex(logsDir, row);
	return true;
}

interface Capture {
	timer: ReturnType<typeof setTimeout>;
}

// Pinned to globalThis so dev-mode hot reload doesn't orphan the interval timers.
const globalForCapture = globalThis as unknown as { __codebayLogCapture?: Map<string, Capture> };
const captures: Map<string, Capture> = (globalForCapture.__codebayLogCapture ??= new Map());

async function tick(id: string, cap: Capture): Promise<void> {
	// Re-read every tick: a rename has to reach index.json, and a stale container_id would exec
	// against a container that no longer exists.
	const row = getInstance(id);
	// Best-effort: a failed pass (container just stopped, transient exec error) must not kill the loop.
	const ok = row ? await runCapturePass(row).catch(() => false) : false;
	// syncLogCapture would normally stop us, but it only runs from the reconcile loop, which is idle
	// whenever no client is connected — so a container that died on its own has to end the chain here.
	const alive =
		ok || (!!row?.container_id && (await isRunning(row.container_id).catch(() => false)));
	// Stopped or replaced while the pass was in flight — rescheduling would leak a second chain.
	if (captures.get(id) !== cap) return;
	if (!alive) {
		stopLogCapture(id);
		return;
	}
	cap.timer = setTimeout(() => void tick(id, cap), CAPTURE_MS);
}

function startLogCapture(id: string): void {
	if (captures.has(id)) return;
	const cap: Capture = { timer: setTimeout(() => undefined, 0) };
	captures.set(id, cap);
	// Seed a pass now so a short-lived session is captured without waiting a full interval.
	void tick(id, cap);
}

/** Stops the timer only — the mirrored logs are retained on disk past instance deletion. */
export function stopLogCapture(id: string): void {
	const cap = captures.get(id);
	if (!cap) return;
	clearTimeout(cap.timer);
	captures.delete(id);
}

/** Driven from the reconcile loop, so capture tracks the container lifecycle automatically. */
export function syncLogCapture(rows: InstanceRow[]): void {
	const running = new Set(
		rows.filter((r) => r.status === 'running' && r.container_id).map((r) => r.id)
	);
	for (const row of rows) {
		if (running.has(row.id) && !captures.has(row.id)) startLogCapture(row.id);
	}
	for (const id of [...captures.keys()]) {
		if (!running.has(id)) stopLogCapture(id);
	}
}
