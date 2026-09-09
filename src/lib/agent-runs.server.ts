import {
	agentsFor,
	isAgent,
	CODEX_PERMISSION_MODES,
	CODEX_EFFORT_LEVELS,
	type Agent,
	type CodexPermissionMode
} from '../agents.ts';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './config.server.ts';
import {
	getInstance,
	getRun,
	listRuns,
	insertRun,
	openRunFor,
	openRuns,
	updateRun,
	type AgentRunRow,
	type InstanceRow
} from './db.server.ts';
import {
	EXEC_STDIN_MAX_BYTES,
	execInContainer,
	execTargetFor as targetFor,
	markerLine
} from './exec.server.ts';
import {
	HOME_PRELUDE,
	shellSingleQuote as quote,
	writeContainerFile
} from './container-files.server.ts';
import {
	FETCH_MARKER,
	parseFetchBlocks,
	sizeOnDisk,
	tailBlockScript
} from './log-capture.server.ts';
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
	readRunFile,
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

/**
 * Per-pass ceiling on stream bytes. Unbounded, a mirror far behind (manager down, a tool that
 * dumped megabytes) makes every pass time out at the same offset until the strikes kill a live run.
 */
const POLL_CHUNK_BYTES = 2 * 1024 * 1024;

/** The prompt is staged through the exec env carrier, so it inherits that carrier's ceiling. */
export const PROMPT_MAX_BYTES = EXEC_STDIN_MAX_BYTES;

/** How long a cancel waits for claude to flush the result it records on SIGINT before the last tail. */
const STOP_DRAIN_SECONDS = 5;

export interface StartRunOptions {
	agent?: Agent;
	codexPermissionMode?: CodexPermissionMode;
	reasoningEffort?: string;
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

const mirrorSize = (runId: string) => sizeOnDisk(runMirrorPath(runId));

/**
 * The script the detached process actually runs. It writes its own PGID first so `stopRun` can
 * signal the whole group, and writes the exit file last so the poller can treat that file's
 * appearance as proof the stream is complete.
 */
function runScript(runId: string, row: InstanceRow, opts: StartRunOptions): string {
	const agent = opts.agent ?? 'claude';
	const flags = [
		'--output-format stream-json',
		'--verbose',
		claudePermissionFlags(opts.permissionMode ?? 'default')
	];
	if (opts.resumeSessionId) flags.push(`--resume ${quote(opts.resumeSessionId)}`);
	if (opts.model) flags.push(`--model ${quote(opts.model)}`);
	if (opts.maxTurns) flags.push(`--max-turns ${opts.maxTurns}`);
	if (opts.jsonSchema) flags.push('--json-schema "$(cat "$d/schema.json")"');

	const codexFlags = ['--json', '--skip-git-repo-check'];
	if (!opts.codexPermissionMode || opts.codexPermissionMode === 'full-access')
		codexFlags.push('--dangerously-bypass-approvals-and-sandbox');
	else
		codexFlags.push(
			`-c approval_policy="never" -c sandbox_mode="${opts.codexPermissionMode === 'workspace' ? 'workspace-write' : 'read-only'}"`
		);
	if (opts.model) codexFlags.push(`--model ${quote(opts.model)}`);
	if (opts.reasoningEffort && opts.reasoningEffort !== 'default')
		codexFlags.push(`-c ${quote(`model_reasoning_effort="${opts.reasoningEffort}"`)}`);
	if (opts.jsonSchema) codexFlags.push('--output-schema "$d/schema.json"');
	const command =
		agent === 'codex'
			? `codex exec ${opts.resumeSessionId ? `resume ${quote(opts.resumeSessionId)} ` : ''}${codexFlags.join(' ')} - < "$d/prompt.txt"`
			: `claude -p "$(cat "$d/prompt.txt")" ${flags.join(' ')} </dev/null`;
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
		// Tells the IDE/terminal launchers not to start a second Claude beside this one. The KILL
		// step of stopScript removes it itself.
		`m="$HOME/${AGENT_RUN_MARKER}"; : > "$m"; trap 'rm -f "$m"' EXIT\n` +
		// A trapped signal only runs its handler and lets bash carry on, so without the explicit
		// exit a cancel that lands during the wait loops below would still go on to launch claude.
		`trap 'w exit 130; exit 130' INT; trap 'w exit 143; exit 143' TERM\n` +
		// Claude Code refuses --dangerously-skip-permissions under uid 0, which is exactly what an
		// instance with no resolved remote_user execs as.
		`[ "$(id -u)" = 0 ] && export IS_SANDBOX=1\n` +
		// A run queued while the instance was still booting must not race the injections that
		// install and authenticate Claude Code.
		`${WAIT_FOR_INJECTIONS}\n` +
		`${cd} || die 127 "workspace folder is missing"\n` +
		`${SOURCE_INJECTED_ENV}\n` +
		`i=0; until command -v ${agent} >/dev/null 2>&1 || [ "$i" -ge ${CLAUDE_BINARY_WAIT_SECONDS} ]; do sleep 1; i=$((i + 1)); done\n` +
		`command -v ${agent} >/dev/null 2>&1 || die 127 "${agent} is not installed in this container"\n` +
		`${command} > "$d/stream.jsonl" 2> "$d/stderr.log"\n` +
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
		`${tailBlockScript('$d/stream.jsonl', String(offset + 1), POLL_CHUNK_BYTES)}; ` +
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

/** Waits for the exit file so a tail that follows a signal sees the result claude flushes on its way out. */
function waitForExitScript(runId: string, seconds: number): string {
	return (
		`${HOME_PRELUDE}d="${runDirExpr(runId)}"; ` +
		`i=0; while [ ! -f "$d/exit" ] && [ "$i" -lt ${seconds} ]; do sleep 1; i=$((i + 1)); done; `
	);
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

/** Like `once`, but for work that must run itself rather than join a pass already in flight. */
async function afterInFlight(runId: string, work: () => Promise<void>): Promise<void> {
	let pending: Promise<void> | undefined;
	while ((pending = registry.inFlight.get(runId))) await pending;
	return once(runId, work);
}

/** Appends a pass's fetched bytes to the mirror; null when the pass carried nothing new. */
function mirrorChunk(runId: string, stdout: string): Buffer | null {
	const [block] = parseFetchBlocks(stdout);
	if (!block?.base64) return null;
	const bytes = Buffer.from(block.base64, 'base64');
	if (!bytes.length) return null;
	mkdirSync(LOGS_DIR, { recursive: true });
	appendFileSync(runMirrorPath(runId), bytes);
	return bytes;
}

/** The mirror is the record; the cursor is only a cache of it, and can lag it. */
function stateFromMirror(runId: string, fallback: RunStreamState): RunStreamState {
	try {
		return readRunFile(
			readFileSync(runMirrorPath(runId), 'utf8'),
			getRun(runId)?.agent ?? 'claude'
		);
	} catch {
		return fallback;
	}
}

/** Rebuilt from the host mirror, so a manager restart mid-run picks up exactly where it left off. */
function cursorFor(runId: string): RunCursor {
	let cursor = registry.cursors.get(runId);
	if (!cursor) {
		let state = emptyRunState();
		let carry = '';
		try {
			({ state, carry } = readRunChunk(
				state,
				'',
				readFileSync(runMirrorPath(runId), 'utf8'),
				getRun(runId)?.agent ?? 'claude'
			));
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

/** The one projection of a run row every reader shares, so the Agent log and MCP can't drift apart. */
export function runDetail(row: AgentRunRow) {
	return {
		id: row.id,
		agent: row.agent ?? 'claude',
		token_usage: row.token_usage ? (JSON.parse(row.token_usage) as Record<string, number>) : null,
		instance_id: row.instance_id,
		status: row.status,
		prompt: row.prompt,
		session_id: row.session_id,
		resume_session_id: row.resume_session_id,
		model: row.model,
		requested_model: requestedModel(row),
		last_activity: row.last_activity,
		result: row.result,
		structured_output: row.structured_output
			? (JSON.parse(row.structured_output) as unknown)
			: null,
		is_error: row.is_error === 1,
		error: row.error,
		exit_code: row.exit_code,
		num_turns: row.num_turns,
		cost_usd: row.cost_usd,
		duration_ms: row.duration_ms,
		created_at: row.created_at,
		started_at: row.started_at,
		finished_at: row.finished_at
	};
}

export function runSummary(row: AgentRunRow): AgentRunSummary {
	const { id, instance_id, status, last_activity, started_at, finished_at, is_error } =
		runDetail(row);
	return {
		id,
		instance_id,
		status,
		last_activity,
		started_at,
		finished_at,
		is_error,
		agent: row.agent ?? 'claude'
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
	if (!agentsFor(instance.agent_selection ?? 'claude').includes(row.agent ?? 'claude'))
		return 'The run agent is not installed in this sandbox; rebuild with it enabled';
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
		runScript(row.id, instance, {
			...opts,
			agent: row.agent ?? 'claude',
			resumeSessionId: row.resume_session_id ?? undefined
		})
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
		// The script detaches and returns at once, so anything slower is a wedged stream — and this
		// runs under once(), where a hung exec would also hang every get_run for the row.
		const res = await execInContainer(targetFor(instance), {
			script: launchScript(row.id),
			timeoutMs: 30_000
		});
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
		const [exitRaw = '', aliveRaw = ''] = (markerLine(res.stdout, STATE_MARKER) ?? '')
			.split('\t')
			.map((f) => f.trim());

		const bytes = mirrorChunk(row.id, res.stdout);
		const changed = bytes !== null;
		if (bytes) {
			const text = cursor.decoder.decode(bytes, { stream: true });
			const next = readRunChunk(cursor.state, cursor.carry, text, row.agent ?? 'claude');
			cursor.state = next.state;
			cursor.carry = next.carry;
		}

		// The row may have been cancelled while the exec was out; the mirror still got its bytes.
		if (getRun(row.id)?.status !== 'running') return;

		// The terminal fold reads the whole mirror rather than trusting the cursor: a chunk this
		// process never fetched (a second manager on the same DATA_DIR did) is still on disk.
		const state = exitRaw ? stateFromMirror(row.id, cursor.state) : cursor.state;
		if (changed) {
			updateRun(row.id, {
				session_id: state.sessionId,
				model: state.model,
				last_activity: state.lastActivity,
				num_turns: state.numTurns,
				token_usage: state.tokenUsage ? JSON.stringify(state.tokenUsage) : null,
				cost_usd: state.costUsd
			});
			onRunChanged?.(row.id);
		}

		if (exitRaw) {
			const exitCode = Number.parseInt(exitRaw, 10);
			if (row.agent === 'codex' && optionsOf(row).jsonSchema && !state.isError) {
				try {
					state.structuredOutput = JSON.stringify(JSON.parse(state.result ?? ''));
				} catch {
					state.isError = true;
					state.result = 'Codex did not return valid structured JSON';
				}
			}
			const failed =
				state.isError || exitCode !== 0 || (row.agent === 'codex' && !state.resultSeen);
			const stderr = markerLine(res.stdout, ERR_MARKER)?.trim();
			finish(row.id, {
				status: failed ? 'error' : 'done',
				exit_code: exitCode,
				is_error: failed ? 1 : 0,
				result: state.result,
				structured_output: state.structuredOutput,
				duration_ms: state.durationMs ?? (row.started_at ? Date.now() - row.started_at : null),
				num_turns: state.numTurns,
				token_usage: state.tokenUsage ? JSON.stringify(state.tokenUsage) : null,
				cost_usd: state.costUsd,
				session_id: state.sessionId,
				model: state.model,
				last_activity: state.lastActivity,
				// The stream's own result text is the better message when claude exited cleanly but
				// reported a failure; stderr only carries anything when it crashed outright.
				error: failed
					? stderr || state.result || `${row.agent ?? 'claude'} exited ${exitCode}`
					: null
			});
			return;
		}

		const timeoutMs = optionsOf(row).timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (row.started_at && Date.now() - row.started_at > timeoutMs) {
			await stopRun(row.id, `timed out after ${Math.round(timeoutMs / 60_000)} minutes`, {
				failed: true
			});
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
	const agent = opts.agent ?? instance.agent ?? 'claude';
	if (!isAgent(agent) || !agentsFor(instance.agent_selection ?? 'claude').includes(agent))
		throw new Error('Agent is not installed in this sandbox; enable it in Settings and rebuild');
	if (agent === 'codex' && (opts.maxTurns !== undefined || opts.permissionMode !== undefined))
		throw new Error(
			'max_turns and permission_mode are Claude-only; use timeout_minutes and codex_permission_mode for Codex'
		);
	if (
		agent === 'claude' &&
		(opts.codexPermissionMode !== undefined || opts.reasoningEffort !== undefined)
	)
		throw new Error('codex_permission_mode and reasoning_effort are Codex-only');
	if (
		opts.codexPermissionMode !== undefined &&
		!CODEX_PERMISSION_MODES.includes(opts.codexPermissionMode)
	)
		throw new Error('Invalid Codex permission mode');
	if (
		opts.reasoningEffort !== undefined &&
		!(CODEX_EFFORT_LEVELS as readonly string[]).includes(opts.reasoningEffort)
	)
		throw new Error('Invalid Codex reasoning effort');
	if (opts.resumeSessionId) {
		const previous = listRuns(instance.id, 10000).find(
			(run) => run.session_id === opts.resumeSessionId
		);
		if (previous && (previous.agent ?? 'claude') !== agent)
			throw new Error('Cannot resume a session with a different agent');
	}
	opts = { ...opts, agent };
	if (!prompt.trim()) throw new Error('prompt is required');
	const promptBytes = Buffer.byteLength(prompt, 'utf8');
	if (promptBytes > PROMPT_MAX_BYTES) {
		throw new Error(
			`prompt is ${promptBytes} bytes; a run carries at most ${PROMPT_MAX_BYTES} — put the bulk in a ` +
				'workspace file and refer to it'
		);
	}
	if (instance.status === 'error') throw new Error('sandbox failed to build');
	// Claude Code keeps one session directory per project, so two concurrent runs would interleave.
	const open = openRunFor(instance.id);
	if (open) throw new Error(`sandbox already has an active run (${open.id})`);

	const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

	const row: AgentRunRow = {
		id,
		instance_id: instance.id,
		prompt,
		agent,
		token_usage: null,
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
 * SIGINT first, because Claude Code ends the turn cleanly and records a result on it where SIGTERM
 * leaves the turn unfinished; `failed` marks a stop the caller didn't ask for (a timeout) as an error.
 */
export async function stopRun(
	runId: string,
	reason = 'cancelled by the caller',
	{ failed = false } = {}
): Promise<AgentRunRow> {
	const row = getRun(runId);
	if (!row) throw new Error('Run not found');
	if (row.status !== 'running' && row.status !== 'queued') return row;
	// The mirror, not the cursor: after a manager restart no cursor exists until the first pass.
	const state = stateFromMirror(runId, registry.cursors.get(runId)?.state ?? emptyRunState());
	// Settled before the signal goes out, so a caller that doesn't await (rebuild) still sees the
	// slot free and the poller stops exec'ing into a container that is on its way out.
	finish(runId, {
		status: failed ? 'error' : 'cancelled',
		is_error: failed ? 1 : 0,
		error: reason,
		result: state.result ?? null,
		last_activity: state.lastActivity ?? row.last_activity,
		duration_ms: row.started_at ? Date.now() - row.started_at : null
	});
	const instance = getInstance(row.instance_id);
	if (instance?.container_id) {
		const target = targetFor(instance);
		// SIGINT lets claude flush its result event and exit cleanly; the rest is for a wedged process.
		await execInContainer(target, { script: stopScript(runId, 'INT'), timeoutMs: 15_000 });
		for (const [delay, signal] of [
			[STOP_DRAIN_SECONDS * 1000, 'TERM'],
			[STOP_DRAIN_SECONDS * 2000, 'KILL']
		] as const) {
			// stopScript itself checks the process is still this run, so a clean exit makes these no-ops.
			setTimeout(() => {
				void execInContainer(target, { script: stopScript(runId, signal), timeoutMs: 15_000 });
			}, delay).unref?.();
		}
		await drainAfterStop(runId, instance);
	}
	return getRun(runId)!;
}

/**
 * The poller never visits a cancelled row again, so without this last tail the result claude flushed
 * on SIGINT would sit in the container and never reach the row or the mirror.
 */
async function drainAfterStop(runId: string, instance: InstanceRow): Promise<void> {
	await afterInFlight(runId, async () => {
		const res = await execInContainer(targetFor(instance), {
			script: waitForExitScript(runId, STOP_DRAIN_SECONDS) + pollScript(runId, mirrorSize(runId)),
			capture: true,
			timeoutMs: (STOP_DRAIN_SECONDS + 25) * 1000
		});
		if (!res.ok || !mirrorChunk(runId, res.stdout)) return;
		const state = stateFromMirror(runId, emptyRunState());
		updateRun(runId, {
			session_id: state.sessionId,
			model: state.model,
			last_activity: state.lastActivity,
			num_turns: state.numTurns,
			token_usage: state.tokenUsage ? JSON.stringify(state.tokenUsage) : null,
			cost_usd: state.costUsd,
			result: state.result
		});
		onRunChanged?.(runId);
	});
}

/**
 * The run's steps, rendered by the instance page's Agent log. Read from the host mirror rather than
 * the container, so it still works after the sandbox is gone.
 */
export function runTimeline(runId: string, limit = 500): RunTimelineEntry[] {
	try {
		return parseRunTimeline(
			readFileSync(runMirrorPath(runId), 'utf8'),
			getRun(runId)?.agent ?? 'claude'
		).slice(-limit);
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
