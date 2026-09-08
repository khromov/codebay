import { CODEX_PERMISSION_MODES, CODEX_EFFORT_LEVELS } from '../agents.ts';
import * as v from 'valibot';
import type { McpServer } from 'tmcp';
import { tool } from 'tmcp/utils';
import {
	createInstance,
	deleteInstance,
	listInstances,
	sanitizeInstance,
	subscribeLogs
} from '../lib/instances.server.ts';
import { getInstance, getRun, listRuns, type AgentRunRow } from '../lib/db.server.ts';
import {
	PROMPT_MAX_BYTES,
	pollRunNow,
	readRunLog,
	runDetail,
	startRun,
	stopRun
} from '../lib/agent-runs.server.ts';
import {
	WRITE_FILE_MAX_BYTES,
	createPr,
	execCommand,
	gitDiff,
	gitPush,
	readWorkspaceFile,
	writeWorkspaceFile
} from '../lib/sandbox-ops.server.ts';
import { currentHealthSnapshots } from '../lib/health.server.ts';
import { proxyPathFor } from '../lib/proxy.server.ts';
import { PUBLIC_ORIGIN } from '../lib/config.server.ts';
import { CLAUDE_PERMISSION_MODES, normalizeMode } from '../types.ts';

/** Long-polling `get_run` past this would start tripping MCP clients' own request timeouts. */
const MAX_WAIT_SECONDS = 60;

const sandboxId = v.pipe(v.string(), v.minLength(1), v.description('The sandbox id.'));

function requireInstance(id: string) {
	const row = getInstance(id);
	if (!row) throw new Error(`No sandbox with id ${id}`);
	return row;
}

/** Every tool that touches the container needs one that is actually up. */
function requireRunning(id: string) {
	const row = requireInstance(id);
	if (!row.container_id || row.status !== 'running') {
		throw new Error(
			row.status === 'creating'
				? 'the sandbox is still building — poll get_sandbox until status is "running"'
				: `the sandbox is ${row.status}, not running`
		);
	}
	return row;
}

/** The IDE link is what makes a sandbox inspectable by a human, so every sandbox payload carries it. */
const ideUrl = (id: string) => `${PUBLIC_ORIGIN}${proxyPathFor(id)}`;

function sandboxPayload(row: ReturnType<typeof requireInstance>) {
	return { ...sanitizeInstance(row), ide_url: ideUrl(row.id) };
}

/** The prompt is left out: the caller wrote it, and it can be as large as the carrier allows. */
function runPayload(run: AgentRunRow) {
	const { id, instance_id, prompt: _prompt, ...detail } = runDetail(run);
	return { run_id: id, sandbox_id: instance_id, ...detail };
}

/**
 * A failed call reaches the model as readable content rather than a JSON-RPC protocol error: the
 * caller is an agent, and "that sandbox is still building" is information it can act on.
 */
function safe<T>(run: (input: T) => unknown) {
	return async (input: T) => {
		try {
			return tool.text(JSON.stringify(await run(input), null, 2));
		} catch (err) {
			return tool.error((err as Error).message);
		}
	};
}

const runOptions = {
	agent: v.optional(v.picklist(['claude', 'codex'] as const)),
	codex_permission_mode: v.optional(v.picklist(CODEX_PERMISSION_MODES)),
	reasoning_effort: v.optional(v.picklist(CODEX_EFFORT_LEVELS)),
	resume_session_id: v.optional(
		v.pipe(
			v.string(),
			v.description(
				'Continue a previous run’s session with the same agent instead of starting fresh.'
			)
		)
	),
	model: v.optional(
		v.pipe(
			v.string(),
			v.description(
				'Model alias or id, e.g. "sonnet". Omit for the sandbox default. The run reports the id ' +
					'the agent actually used as `model` when its native stream reports it; Codex may leave it unset.'
			)
		)
	),
	max_turns: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			v.description('Claude only. Use timeout_minutes for a Codex run limit.')
		)
	),
	json_schema: v.optional(
		v.pipe(
			v.string(),
			v.description(
				'A JSON Schema (as a string). When set, the run’s structured_output matches it.'
			)
		)
	),
	permission_mode: v.optional(
		v.pipe(
			v.picklist(CLAUDE_PERMISSION_MODES),
			v.description(
				'Tightens what Claude may do. Omit for full autonomy, which is the default for MCP runs.'
			)
		)
	),
	timeout_minutes: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(240)))
};

type RunOptionInput = v.InferInput<v.ObjectSchema<typeof runOptions, undefined>>;

// The byte limits are enforced at runtime (startRun, writeWorkspaceFile) and only documented here:
// a `v.check` can't be rendered into the JSON Schema an MCP client reads.
const promptSchema = (description: string) =>
	v.pipe(
		v.string(),
		v.minLength(1),
		v.description(
			`${description} At most ${PROMPT_MAX_BYTES} bytes of UTF-8; refer to a workspace file for anything larger.`
		)
	);

function toStartOptions(input: RunOptionInput) {
	return {
		agent: input.agent,
		codexPermissionMode: input.codex_permission_mode,
		reasoningEffort: input.reasoning_effort,
		resumeSessionId: input.resume_session_id,
		model: input.model,
		maxTurns: input.max_turns,
		jsonSchema: input.json_schema,
		permissionMode: input.permission_mode,
		timeoutMs: input.timeout_minutes ? input.timeout_minutes * 60_000 : undefined
	};
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerTools(server: McpServer<v.GenericSchema>): void {
	/** Registers a tool whose handler returns a plain payload; `safe` serialises it and traps errors. */
	function define<E extends v.ObjectEntries>(
		options: { name: string; description: string; schema: v.ObjectSchema<E, undefined> },
		run: (input: v.InferInput<v.ObjectSchema<E, undefined>>) => unknown
	): void {
		server.tool(options, safe(run));
	}

	define(
		{
			name: 'create_sandbox',
			description:
				'Create an isolated devcontainer sandbox from a Git repo URL or a local folder path on ' +
				'the Codebay host. Returns immediately while the container builds in the background; poll ' +
				'get_sandbox until status is "running". Pass a prompt to queue an agent run that starts ' +
				'as soon as the sandbox is up.',
			schema: v.object({
				source: v.pipe(
					v.string(),
					v.minLength(1),
					v.description('A Git repo URL (cloned) or an absolute local folder path (copied).')
				),
				name: v.optional(v.string()),
				branch: v.optional(v.pipe(v.string(), v.description('Branch to check out after cloning.'))),
				mode: v.optional(v.picklist(['ide', 'terminal'] as const)),
				prompt: v.optional(promptSchema('Queues an agent run once the sandbox is running.')),
				...runOptions
			})
		},
		async (input) => {
			const instance = await createInstance(input.source, input.name, {
				branch: input.branch,
				mode: input.mode ? normalizeMode(input.mode) : undefined,
				agent: input.agent
			});
			// The sandbox exists once createInstance returns, so a failed run must not swallow its id —
			// the caller would retry and leak the first one.
			let run: AgentRunRow | null = null;
			let runError: string | undefined;
			try {
				if (input.prompt) run = startRun(instance, input.prompt, toStartOptions(input));
			} catch (err) {
				runError = err instanceof Error ? err.message : String(err);
			}
			return {
				sandbox: sandboxPayload(instance),
				run: run ? runPayload(run) : null,
				...(runError ? { run_error: runError } : {}),
				note: 'The sandbox is building. Poll get_sandbox until status is "running".'
			};
		}
	);

	define(
		{
			name: 'list_sandboxes',
			description:
				'List every sandbox Codebay is managing, with its status and any run currently in flight.',
			schema: v.object({
				status: v.optional(v.picklist(['creating', 'running', 'stopped', 'error'] as const))
			})
		},
		async (input) => {
			const all = await listInstances();
			const rows = input.status ? all.filter((i) => i.status === input.status) : all;
			return {
				sandboxes: rows.map((row) => ({ ...row, ide_url: ideUrl(row.id) }))
			};
		}
	);

	define(
		{
			name: 'get_sandbox',
			description:
				'Full detail for one sandbox: status, health probes, forwarded ports and its active run.',
			schema: v.object({ sandbox_id: sandboxId })
		},
		async (input) => {
			const row = requireInstance(input.sandbox_id);
			const health = currentHealthSnapshots().find((s) => s.id === row.id)?.health ?? null;
			const runs = listRuns(row.id, 5);
			return {
				sandbox: sandboxPayload(row),
				health,
				runs: runs.map(runPayload)
			};
		}
	);

	define(
		{
			name: 'delete_sandbox',
			description:
				'Destroy a sandbox: cancels any active run, removes the container and its workspace copy. ' +
				'Mirrored run transcripts are kept.',
			schema: v.object({ sandbox_id: sandboxId })
		},
		async (input) => {
			requireInstance(input.sandbox_id);
			await deleteInstance(input.sandbox_id);
			return { deleted: input.sandbox_id };
		}
	);

	define(
		{
			name: 'run_agent',
			description:
				'Run the selected coding agent non-interactively against the sandbox and return a run handle. The run ' +
				'continues in the background; poll get_run for progress and the final result. Only one ' +
				'run at a time per sandbox.',
			schema: v.object({
				sandbox_id: sandboxId,
				prompt: promptSchema('What the agent should do.'),
				...runOptions
			})
		},
		(input) => {
			const row = requireInstance(input.sandbox_id);
			return { run: runPayload(startRun(row, input.prompt, toStartOptions(input))) };
		}
	);

	define(
		{
			name: 'get_run',
			description:
				'Status and result of an agent run. While it is still going you get the live session id, ' +
				'model, turn count, cost and what the agent is doing right now. Set wait_seconds to block until it ' +
				'finishes instead of polling.',
			schema: v.object({
				run_id: v.pipe(v.string(), v.minLength(1)),
				wait_seconds: v.optional(
					v.pipe(
						v.number(),
						v.integer(),
						v.minValue(0),
						v.maxValue(MAX_WAIT_SECONDS),
						v.description('Block up to this long for the run to finish before answering.')
					)
				)
			})
		},
		async (input) => {
			if (!getRun(input.run_id)) throw new Error(`No run with id ${input.run_id}`);
			const deadline = Date.now() + (input.wait_seconds ?? 0) * 1000;
			let run = await pollRunNow(input.run_id);
			while (
				run &&
				(run.status === 'running' || run.status === 'queued') &&
				Date.now() < deadline
			) {
				await sleep(2000);
				run = await pollRunNow(input.run_id);
			}
			return { run: runPayload(run!) };
		}
	);

	define(
		{
			name: 'list_runs',
			description: 'Run history for a sandbox, newest first.',
			schema: v.object({
				sandbox_id: sandboxId,
				limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)))
			})
		},
		(input) => {
			requireInstance(input.sandbox_id);
			return { runs: listRuns(input.sandbox_id, input.limit ?? 20).map(runPayload) };
		}
	);

	define(
		{
			name: 'stop_run',
			description:
				'Cancel an agent run. Sends SIGINT first so the agent can end its turn cleanly, then ' +
				'escalates if it does not exit.',
			schema: v.object({ run_id: v.pipe(v.string(), v.minLength(1)) })
		},
		async (input) => ({ run: runPayload(await stopRun(input.run_id)) })
	);

	define(
		{
			name: 'get_diff',
			description:
				'The sandbox workspace’s uncommitted changes as a unified diff, plus a porcelain ' +
				'status summary and the current branch. This is how you see what an agent run actually did.',
			schema: v.object({
				sandbox_id: sandboxId,
				base: v.optional(
					v.pipe(v.string(), v.description('Diff against this ref instead of the working tree.'))
				),
				staged: v.optional(v.boolean())
			})
		},
		async (input) =>
			await gitDiff(requireRunning(input.sandbox_id), {
				base: input.base,
				staged: input.staged
			})
	);

	define(
		{
			name: 'read_file',
			description:
				'Read a file from the sandbox workspace, by path relative to the workspace root.',
			schema: v.object({ sandbox_id: sandboxId, path: v.pipe(v.string(), v.minLength(1)) })
		},
		async (input) => ({
			path: input.path,
			content: await readWorkspaceFile(requireRunning(input.sandbox_id), input.path)
		})
	);

	define(
		{
			name: 'write_file',
			description:
				'Write a file into the sandbox workspace, creating parent directories as needed. Useful ' +
				`for seeding config or fixtures before prompting the agent. Content is capped at ${WRITE_FILE_MAX_BYTES} ` +
				'bytes per call; build anything larger inside the sandbox with exec_command.',
			schema: v.object({
				sandbox_id: sandboxId,
				path: v.pipe(v.string(), v.minLength(1)),
				content: v.pipe(
					v.string(),
					v.description(`The file's full UTF-8 text, at most ${WRITE_FILE_MAX_BYTES} bytes.`)
				)
			})
		},
		async (input) => {
			await writeWorkspaceFile(requireRunning(input.sandbox_id), input.path, input.content);
			return { path: input.path, written: true };
		}
	);

	define(
		{
			name: 'exec_command',
			description:
				'Run a shell command in the sandbox, from the workspace root, and capture its output. ' +
				'Bounded by timeout_seconds (default 120).',
			schema: v.object({
				sandbox_id: sandboxId,
				command: v.pipe(v.string(), v.minLength(1)),
				cwd: v.optional(
					v.pipe(v.string(), v.description('Run from here instead of the workspace root.'))
				),
				timeout_seconds: v.optional(
					v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3600))
				)
			})
		},
		async (input) =>
			await execCommand(requireRunning(input.sandbox_id), input.command, {
				timeoutSeconds: input.timeout_seconds,
				cwd: input.cwd
			})
	);

	define(
		{
			name: 'git_push',
			description:
				'Commit any pending changes and push the sandbox branch to origin. Git and gh are already ' +
				'authenticated inside the container, so no credentials are needed here.',
			schema: v.object({
				sandbox_id: sandboxId,
				branch: v.optional(
					v.pipe(v.string(), v.description('Branch to push to; defaults to the current one.'))
				),
				commit_message: v.optional(
					v.pipe(
						v.string(),
						v.description('Commit everything outstanding under this message first.')
					)
				),
				force: v.optional(v.pipe(v.boolean(), v.description('Push with --force-with-lease.')))
			})
		},
		async (input) =>
			await gitPush(requireRunning(input.sandbox_id), {
				branch: input.branch,
				commitMessage: input.commit_message,
				force: input.force
			})
	);

	define(
		{
			name: 'create_pr',
			description: 'Open a pull request from the sandbox branch using the container’s gh CLI.',
			schema: v.object({
				sandbox_id: sandboxId,
				title: v.pipe(v.string(), v.minLength(1)),
				body: v.optional(v.string()),
				base: v.optional(v.string()),
				draft: v.optional(v.boolean())
			})
		},
		async (input) =>
			await createPr(requireRunning(input.sandbox_id), {
				title: input.title,
				body: input.body,
				base: input.base,
				draft: input.draft
			})
	);

	define(
		{
			name: 'get_logs',
			description:
				'Logs for a sandbox. kind "boot" is the provisioning log (why a build failed); kind "run" ' +
				'is the mirrored event stream of an agent run.',
			schema: v.object({
				sandbox_id: sandboxId,
				kind: v.picklist(['boot', 'run'] as const),
				run_id: v.optional(v.string()),
				tail: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2000)))
			})
		},
		(input) => {
			requireInstance(input.sandbox_id);
			const tail = input.tail ?? 200;
			if (input.kind === 'run') {
				if (!input.run_id) throw new Error('run_id is required for kind "run"');
				// Resolve through the DB so the id is a known token, never a path fragment.
				const run = getRun(input.run_id);
				if (!run || run.instance_id !== input.sandbox_id) {
					throw new Error(`No run ${input.run_id} in sandbox ${input.sandbox_id}`);
				}
				return { kind: 'run', run_id: run.id, log: readRunLog(run.id, tail) };
			}
			// subscribeLogs replays the buffer synchronously before it starts streaming, so
			// unsubscribing straight away leaves us with exactly the captured boot log.
			const lines: string[] = [];
			subscribeLogs(input.sandbox_id, (chunk) => lines.push(chunk))();
			return { kind: 'boot', log: lines.join('').split('\n').slice(-tail).join('\n') };
		}
	);
}
