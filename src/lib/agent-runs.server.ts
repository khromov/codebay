import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './config.server.ts';
import {
	getInstance,
	getRun,
	insertRun,
	openRunFor,
	openRuns,
	updateRun,
	type AgentRunRow,
	type InstanceRow
} from './db.server.ts';
import { execInContainer, type ExecTarget } from './exec.server.ts';
import {
	HOME_PRELUDE,
	shellSingleQuote as quote,
	writeContainerFile
} from './container-files.server.ts';
import { FETCH_MARKER, parseFetchBlocks, tailBlockScript } from './log-capture.server.ts';
import {
	AGENT_RUN_MARKER,
	CLAUDE_BINARY_WAIT_SECONDS,
	SOURCE_INJECTED_ENV,
	WAIT_FOR_INJECTIONS
} from './devcontainer.server.ts';
import {
	claudePermissionFlags,
	type AgentRunSummary,
	type ClaudePermissionMode
} from '../types.ts';
import {
	emptyRunState,
	parseRunTimeline,
	readRunChunk,
	type RunStreamState,
	type RunTimelineEntry
} from './agent-run-stream.ts';

/** Fast enough that a caller polling `get_run` sees movement, cheap enough to leave always-on. */
const POLL_MS = 3000;

const STATE_MARKER = '__CODEBAY_RUNSTATE__';
const ERR_MARKER = '__CODEBAY_RUNERR__';

/** A run whose launcher process vanished without an exit file is dead; don't wait forever. */
const MISSING_PROCESS_STRIKES = 5;

/** A run nobody stops would otherwise hold its sandbox's single slot forever. */
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export interface StartRunOptions {
	resumeSessionId?: string;
	model?: string;
	maxTurns?: number;
	jsonSchema?: string;
	/** Defaults to full autonomy — an MCP run is unattended, and the container is the sandbox. */
	permissionMode?: ClaudePermissionMode;
	timeoutMs?: number;
}

const runDirExpr = (runId: string) => `$h/.codebay/runs/${runId}`;

export function runMirrorPath(runId: string): string {
	return join(LOGS_DIR, `run-${runId}.jsonl`);
}

function mirrorSize(runId: string): number {
	try {
		return statSync(runMirrorPath(runId)).size;
	} catch {
		return 0;
	}
}

function targetFor(row: InstanceRow): ExecTarget {
	return { containerId: row.container_id!, remoteUser: row.remote_user };
}

/**
 * The script the detached process actually runs. It writes its own PGID first so `stopRun` can
 * signal the whole group, and writes the exit file last so the poller can treat that file's
 * appearance as proof the stream is complete.
 */
function runScript(runId: string, row: InstanceRow, opts: StartRunOptions): string {
	const flags = [
		'--output-format stream-json',
		'--verbose',
		claudePermissionFlags(opts.permissionMode ?? 'default')
	];
	if (opts.resumeSessionId) flags.push(`--resume ${quote(opts.resumeSessionId)}`);
	if (opts.model) flags.push(`--model ${quote(opts.model)}`);
	if (opts.maxTurns) flags.push(`--max-turns ${opts.maxTurns}`);
	if (opts.jsonSchema) flags.push('--json-schema "$(cat "$d/schema.json")"');

	const cd = row.remote_workspace_folder ? `cd ${quote(row.remote_workspace_folder)}` : 'cd "$h"';

	return (
		`#!/usr/bin/env bash\n` +
		`${HOME_PRELUDE}[ -n "$HOME" ] || export HOME="$h"\n` +
		`d="${runDirExpr(runId)}"\n` +
		// tmp+mv so the poller can never read a half-written exit file and take it for a real code.
		`w(){ printf '%s' "$2" > "$d/$1.tmp"; mv -f "$d/$1.tmp" "$d/$1"; }\n` +
		`die(){ printf 'codebay: %s\\n' "$2" >> "$d/stderr.log"; w exit "$1"; exit "$1"; }\n` +
		// setsid made this the session leader, so $$ is also the PGID stopRun signals.
		`w pgid "$$"\n` +
		// Tells the IDE/terminal launchers not to start a second Claude beside this one. The trap
		// covers stopRun's INT/TERM; the KILL step of stopScript removes it itself.
		`m="$HOME/${AGENT_RUN_MARKER}"; : > "$m"; trap 'rm -f "$m"' EXIT INT TERM\n` +
		// Claude Code refuses --dangerously-skip-permissions under uid 0, which is exactly what an
		// instance with no resolved remote_user execs as.
		`[ "$(id -u)" = 0 ] && export IS_SANDBOX=1\n` +
		// A run queued while the instance was still booting must not race the injections that
		// install and authenticate Claude Code.
		`${WAIT_FOR_INJECTIONS}\n` +
		`${cd} || die 127 "workspace folder is missing"\n` +
		`${SOURCE_INJECTED_ENV}\n` +
		`i=0; until command -v claude >/dev/null 2>&1 || [ "$i" -ge ${CLAUDE_BINARY_WAIT_SECONDS} ]; do sleep 1; i=$((i + 1)); done\n` +
		`command -v claude >/dev/null 2>&1 || die 127 "claude is not installed in this container"\n` +
		`claude -p "$(cat "$d/prompt.txt")" ${flags.join(' ')} </dev/null > "$d/stream.jsonl" 2> "$d/stderr.log"\n` +
		`w exit "$?"\n`
	);
}

/**
 * `execInContainer` resolves on the exec stream's `end`, which only fires once every attached fd is
 * closed — so the child must redirect all three or the launch call would hang for the whole run.
 * `setsid` gives it its own process group to signal; a minimal image without it still detaches.
 */
function launchScript(runId: string): string {
	const d = runDirExpr(runId);
	return (
		`${HOME_PRELUDE}d="${d}"; ` +
		`[ -f "$d/run.sh" ] || { echo "codebay: run script missing" >&2; exit 1; }; ` +
		`rm -f "$d/exit" "$d/stream.jsonl" "$d/stderr.log" "$d/pgid"; ` +
		`if command -v setsid >/dev/null 2>&1; then setsid nohup bash "$d/run.sh" >/dev/null 2>&1 </dev/null & ` +
		`else nohup bash "$d/run.sh" >/dev/null 2>&1 </dev/null & fi`
	);
}

/**
 * Reads the exit file *before* the stream tail. An exit code observed first proves claude was
 * already dead, so the bytes read after it are final; the reverse order would let a run finish
 * between the two reads and report a complete exit alongside a truncated stream.
 */
function pollScript(runId: string, offset: number): string {
	const d = runDirExpr(runId);
	return (
		`${HOME_PRELUDE}d="${d}"; ` +
		`ex=$(tr -dc '0-9' < "$d/exit" 2>/dev/null); ` +
		`${ALIVE_CHECK(runId)}` +
		`printf '${STATE_MARKER}%s\\t%s\\n' "$ex" "$alive"; ` +
		// run.sh's own trap normally does this; this covers a run that was hard-killed.
		`if [ -n "$ex" ]; then rm -f "$HOME/${AGENT_RUN_MARKER}"; fi; ` +
		// Only worth a read once the run is over; tailing it every pass is pure waste.
		`if [ -n "$ex" ] && [ -s "$d/stderr.log" ]; then printf '${ERR_MARKER}%s\\n' "$(tail -c 2000 "$d/stderr.log" | tr '\\n' ' ')"; fi; ` +
		`printf '%s\\n' '${FETCH_MARKER}'; ` +
		`${tailBlockScript('$d/stream.jsonl', String(offset + 1))}; ` +
		`true`
	);
}

/**
 * Sets `$pg` and `$alive` from `$d/pgid`. Identity, not just `kill -0`: a restarted container
 * reuses low PIDs, so a bare liveness probe would happily report an unrelated process as this run.
 */
const ALIVE_CHECK = (runId: string): string =>
	`pg=$(tr -dc '0-9' < "$d/pgid" 2>/dev/null); ` +
	`alive=0; if [ -n "$pg" ]; then c=$(tr '\\0' ' ' < "/proc/$pg/cmdline" 2>/dev/null); ` +
	`case "$c" in *${runId}*) alive=1 ;; esac; fi; `;

function stopScript(runId: string, signal: 'INT' | 'TERM' | 'KILL'): string {
	const d = runDirExpr(runId);
	return (
		`${HOME_PRELUDE}d="${d}"; ${ALIVE_CHECK(runId)}` +
		// `kill -- -0` would signal every process this user owns, so refuse anything but a live pgid.
		`[ "$alive" = 1 ] && [ "$pg" -gt 1 ] || exit 0; ` +
		// The group kill reaches claude's own children; the bare pid is the setsid-less fallback.
		`kill -${signal} -- "-$pg" 2>/dev/null || kill -${signal} "$pg" 2>/dev/null; ` +
		// KILL skips run.sh's trap, and a cancelled run is never polled again, so nothing else owns it.
		(signal === 'KILL' ? `rm -f "$HOME/${AGENT_RUN_MARKER}" "$d/pgid"; ` : '') +
		`true`
	);
}

/** Returns the marker's line untrimmed — an empty leading field is meaningful to the caller. */
function markerValue(stdout: string, marker: string): string | null {
	const at = stdout.lastIndexOf(marker);
	if (at === -1) return null;
	const rest = stdout.slice(at + marker.length);
	const nl = rest.indexOf('\n');
	return (nl === -1 ? rest : rest.slice(0, nl)).replace(/\r$/, '');
}

/** In-memory per-run cursor: the incomplete trailing line the next chunk has to be prefixed with. */
interface RunCursor {
	carry: string;
	state: RunStreamState;
	missingStrikes: number;
	/** Streaming, because the byte tail can cut a multi-byte character across two passes. */
	decoder: TextDecoder;
}

interface RunRegistry {
	timer?: ReturnType<typeof setInterval>;
	cursors: Map<string, RunCursor>;
	/** The in-flight pass per run, so an overlapping caller joins it instead of seeing stale state. */
	inFlight: Map<string, Promise<void>>;
}

// Pinned like every other long-lived map here, so dev-mode hot reload doesn't orphan the timer.
const globalForRuns = globalThis as unknown as { __codebayRuns?: RunRegistry };
const registry: RunRegistry = (globalForRuns.__codebayRuns ??= {
	cursors: new Map(),
	inFlight: new Map()
});

/**
 * Collapses concurrent passes for one run onto a single promise. Joining rather than skipping is
 * what lets `get_run`, called straight after `run_agent`, observe the launch it triggered.
 */
function once(runId: string, work: () => Promise<void>): Promise<void> {
	const existing = registry.inFlight.get(runId);
	if (existing) return existing;
	const promise = work().finally(() => registry.inFlight.delete(runId));
	registry.inFlight.set(runId, promise);
	return promise;
}

/** Rebuilt from the host mirror, so a manager restart mid-run picks up exactly where it left off. */
function cursorFor(runId: string): RunCursor {
	let cursor = registry.cursors.get(runId);
	if (!cursor) {
		let state = emptyRunState();
		let carry = '';
		try {
			({ state, carry } = readRunChunk(state, '', readFileSync(runMirrorPath(runId), 'utf8')));
		} catch {
			// No mirror yet — a run that hasn't produced output.
		}
		cursor = { carry, state, missingStrikes: 0, decoder: new TextDecoder('utf-8') };
		registry.cursors.set(runId, cursor);
	}
	return cursor;
}

/**
 * Set by `instances.server.ts` at import time. A callback rather than a direct import because the
 * broadcast must not go through `triggerReconcile` — that runs a `docker inspect` per instance, and
 * this fires every few seconds per active run.
 */
let onRunChanged: ((runId: string) => void) | undefined;
export function setRunChangeHook(hook: (runId: string) => void): void {
	onRunChanged = hook;
}

export function runSummary(row: AgentRunRow): AgentRunSummary {
	return {
		id: row.id,
		instance_id: row.instance_id,
		status: row.status,
		last_activity: row.last_activity,
		started_at: row.started_at,
		finished_at: row.finished_at,
		is_error: row.is_error === 1
	};
}

/** Seeds a freshly connected socket, the way `currentHealthSnapshots` does for health. */
export function currentRunSummaries(): AgentRunSummary[] {
	return openRuns().map(runSummary);
}

function finish(runId: string, patch: Parameters<typeof updateRun>[1]): void {
	updateRun(runId, { ...patch, finished_at: Date.now() });
	registry.cursors.delete(runId);
	onRunChanged?.(runId);
}

export function startRunTimer(): void {
	if (registry.timer) return;
	registry.timer = setInterval(() => {
		void tick();
	}, POLL_MS);
	// A pending run must never be the reason the process stays alive.
	registry.timer.unref?.();
}

function stopRunTimer(): void {
	if (!registry.timer) return;
	clearInterval(registry.timer);
	registry.timer = undefined;
}

async function tick(): Promise<void> {
	const rows = openRuns();
	if (!rows.length) {
		stopRunTimer();
		return;
	}
	await Promise.all(rows.map((row) => advance(row)));
}

/** Re-attaches pollers to runs that were in flight when the manager went down. */
export function resumeRuns(): void {
	if (openRuns().length) startRunTimer();
}

async function advance(row: AgentRunRow): Promise<void> {
	const instance = getInstance(row.instance_id);
	if (!instance) {
		finish(row.id, { status: 'error', error: 'sandbox no longer exists', is_error: 1 });
		return;
	}
	if (row.status === 'queued') {
		if (instance.status === 'creating') return; // Still booting; the launcher waits it out.
		if (instance.status !== 'running' || !instance.container_id) {
			finish(row.id, {
				status: 'error',
				error: `sandbox is ${instance.status}, not running`,
				is_error: 1
			});
			return;
		}
		await launch(row, instance);
		return;
	}
	if (!instance.container_id) {
		finish(row.id, { status: 'error', error: 'sandbox has no container', is_error: 1 });
		return;
	}
	await poll(row, instance);
}

function optionsOf(row: AgentRunRow): StartRunOptions {
	try {
		return row.options ? (JSON.parse(row.options) as StartRunOptions) : {};
	} catch {
		return {};
	}
}

/** The alias or id the caller asked for; null when the run took the sandbox default. */
export function requestedModel(row: AgentRunRow): string | null {
	return optionsOf(row).model ?? null;
}

/**
 * Staging happens here rather than in `startRun` because a run may be queued against an instance
 * that is still booting and has no container to write into yet.
 */
async function stage(row: AgentRunRow, instance: InstanceRow): Promise<string | null> {
	const target = targetFor(instance);
	const dir = runDirExpr(row.id);
	const opts = optionsOf(row);
	const wrote = await writeContainerFile(
		target,
		{ dir, name: 'prompt.txt', mode: '600' },
		row.prompt
	);
	if (!wrote.ok) return `could not stage the prompt: ${wrote.error}`;
	if (opts.jsonSchema) {
		const schema = await writeContainerFile(
			target,
			{ dir, name: 'schema.json', mode: '600' },
			opts.jsonSchema
		);
		if (!schema.ok) return `could not stage the schema: ${schema.error}`;
	}
	const script = await writeContainerFile(
		target,
		{ dir, name: 'run.sh', mode: '700' },
		runScript(row.id, instance, { ...opts, resumeSessionId: row.resume_session_id ?? undefined })
	);
	return script.ok ? null : `could not stage the run script: ${script.error}`;
}

function launch(row: AgentRunRow, instance: InstanceRow): Promise<void> {
	return once(row.id, async () => {
		const staged = await stage(row, instance);
		if (staged) {
			finish(row.id, { status: 'error', error: staged, is_error: 1 });
			return;
		}
		// stopRun doesn't go through once(), so a cancel can land while staging is still in flight.
		if (getRun(row.id)?.status !== 'queued') return;
		const res = await execInContainer(targetFor(instance), { script: launchScript(row.id) });
		if (!res.ok) {
			finish(row.id, {
				status: 'error',
				error: `could not start run: ${res.error ?? 'unknown error'}`,
				is_error: 1
			});
			return;
		}
		if (getRun(row.id)?.status !== 'queued') {
			// Cancelled during the launch exec: the process is real now, so put it down.
			void execInContainer(targetFor(instance), {
				script: stopScript(row.id, 'TERM'),
				timeoutMs: 15_000
			});
			return;
		}
		updateRun(row.id, { status: 'running', started_at: Date.now() });
		onRunChanged?.(row.id);
	});
}

function poll(row: AgentRunRow, instance: InstanceRow): Promise<void> {
	return once(row.id, async () => {
		const cursor = cursorFor(row.id);
		const res = await execInContainer(targetFor(instance), {
			script: pollScript(row.id, mirrorSize(row.id)),
			capture: true,
			timeoutMs: 30_000
		});
		if (!res.ok) {
			// A container that went away mid-run can never produce an exit file.
			if (++cursor.missingStrikes >= MISSING_PROCESS_STRIKES) {
				finish(row.id, {
					status: 'error',
					error: `lost contact with the sandbox: ${res.error ?? 'unknown error'}`,
					is_error: 1
				});
			}
			return;
		}

		// Read in the script's own order: the state line was captured before these bytes, so an
		// exit code here guarantees the stream below it is complete.
		const [exitRaw = '', aliveRaw = ''] = (markerValue(res.stdout, STATE_MARKER) ?? '')
			.split('\t')
			.map((f) => f.trim());

		let changed = false;
		const [block] = parseFetchBlocks(res.stdout);
		if (block?.base64) {
			const bytes = Buffer.from(block.base64, 'base64');
			if (bytes.length) {
				mkdirSync(LOGS_DIR, { recursive: true });
				appendFileSync(runMirrorPath(row.id), bytes);
				const text = cursor.decoder.decode(bytes, { stream: true });
				const next = readRunChunk(cursor.state, cursor.carry, text);
				cursor.state = next.state;
				cursor.carry = next.carry;
				changed = true;
			}
		}

		// The row may have been cancelled while the exec was out; the mirror still got its bytes.
		if (getRun(row.id)?.status !== 'running') return;

		const { state } = cursor;
		if (changed) {
			updateRun(row.id, {
				session_id: state.sessionId,
				model: state.model,
				last_activity: state.lastActivity,
				num_turns: state.numTurns,
				cost_usd: state.costUsd
			});
			onRunChanged?.(row.id);
		}

		if (exitRaw) {
			const exitCode = Number.parseInt(exitRaw, 10);
			const failed = state.isError || exitCode !== 0;
			const stderr = markerValue(res.stdout, ERR_MARKER)?.trim();
			finish(row.id, {
				status: failed ? 'error' : 'done',
				exit_code: exitCode,
				is_error: failed ? 1 : 0,
				result: state.result,
				structured_output: state.structuredOutput,
				duration_ms: state.durationMs ?? (row.started_at ? Date.now() - row.started_at : null),
				num_turns: state.numTurns,
				cost_usd: state.costUsd,
				session_id: state.sessionId,
				model: state.model,
				last_activity: state.lastActivity,
				// The stream's own result text is the better message when claude exited cleanly but
				// reported a failure; stderr only carries anything when it crashed outright.
				error: failed ? stderr || state.result || `claude exited ${exitCode}` : null
			});
			return;
		}

		const timeoutMs = optionsOf(row).timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (row.started_at && Date.now() - row.started_at > timeoutMs) {
			await stopRun(row.id, `timed out after ${Math.round(timeoutMs / 60_000)} minutes`);
			return;
		}

		// `alive` covers both a dead process and a missing pgid file: either way, nothing is going
		// to write the exit file, so the container must have restarted under the run.
		if (aliveRaw !== '1') {
			if (++cursor.missingStrikes >= MISSING_PROCESS_STRIKES) {
				finish(row.id, {
					status: 'error',
					error: 'the run process is gone — the sandbox was probably restarted',
					is_error: 1,
					result: state.result
				});
			}
			return;
		}
		cursor.missingStrikes = 0;
	});
}

/** Forces one pass now, so a caller polling `get_run` isn't held to the background cadence. */
export async function pollRunNow(runId: string): Promise<AgentRunRow | null> {
	const row = getRun(runId);
	if (!row || (row.status !== 'running' && row.status !== 'queued')) return row;
	await advance(row);
	return getRun(runId);
}

export function startRun(
	instance: InstanceRow,
	prompt: string,
	opts: StartRunOptions = {}
): AgentRunRow {
	if (!prompt.trim()) throw new Error('prompt is required');
	if (instance.status === 'error') throw new Error('sandbox failed to build');
	// Claude Code keeps one session directory per project, so two concurrent runs would interleave.
	const open = openRunFor(instance.id);
	if (open) throw new Error(`sandbox already has an active run (${open.id})`);

	const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

	const row: AgentRunRow = {
		id,
		instance_id: instance.id,
		prompt,
		status: 'queued',
		session_id: null,
		model: null,
		resume_session_id: opts.resumeSessionId ?? null,
		options: JSON.stringify(opts),
		result: null,
		structured_output: null,
		last_activity: null,
		is_error: 0,
		exit_code: null,
		cost_usd: null,
		duration_ms: null,
		num_turns: null,
		error: null,
		created_at: Date.now(),
		started_at: null,
		finished_at: null
	};
	insertRun(row);
	startRunTimer();
	onRunChanged?.(id);
	// A sandbox that is already up shouldn't wait a poll interval to get going.
	if (instance.status === 'running') void advance(row);
	return row;
}

/**
 * SIGINT first: per Claude Code's headless docs it ends the turn cleanly and records a result,
 * where SIGTERM leaves the turn unfinished. SIGTERM is only the follow-up for a wedged process.
 */
export async function stopRun(
	runId: string,
	reason = 'cancelled by the caller'
): Promise<AgentRunRow> {
	const row = getRun(runId);
	if (!row) throw new Error('Run not found');
	if (row.status !== 'running' && row.status !== 'queued') return row;
	const instance = getInstance(row.instance_id);
	if (instance?.container_id) {
		const target = targetFor(instance);
		// SIGINT lets claude flush its result event and exit cleanly; the rest is for a wedged process.
		await execInContainer(target, { script: stopScript(runId, 'INT'), timeoutMs: 15_000 });
		for (const [delay, signal] of [
			[5000, 'TERM'],
			[10_000, 'KILL']
		] as const) {
			// stopScript itself checks the process is still this run, so a clean exit makes these no-ops.
			setTimeout(() => {
				void execInContainer(target, { script: stopScript(runId, signal), timeoutMs: 15_000 });
			}, delay).unref?.();
		}
	}
	const cursor = registry.cursors.get(runId);
	finish(runId, {
		status: 'cancelled',
		error: reason,
		result: cursor?.state.result ?? null,
		last_activity: cursor?.state.lastActivity ?? row.last_activity,
		duration_ms: row.started_at ? Date.now() - row.started_at : null
	});
	return getRun(runId)!;
}

/**
 * The run's steps, rendered by the instance page's Agent log. Read from the host mirror rather than
 * the container, so it still works after the sandbox is gone.
 */
export function runTimeline(runId: string, limit = 500): RunTimelineEntry[] {
	try {
		return parseRunTimeline(readFileSync(runMirrorPath(runId), 'utf8')).slice(-limit);
	} catch {
		return [];
	}
}

/** The trailing lines of a run's mirrored transcript, for `get_logs`. */
export function readRunLog(runId: string, tailLines = 200): string {
	try {
		const lines = readFileSync(runMirrorPath(runId), 'utf8').split('\n').filter(Boolean);
		return lines.slice(-tailLines).join('\n');
	} catch {
		return '';
	}
}
