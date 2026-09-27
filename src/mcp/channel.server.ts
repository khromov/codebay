import { InMemoryStreamSessionManager } from '@tmcp/session-manager';
import { MAX_WAIT_MS, waitFor, type WaitOutcome } from '../lib/waits.server.ts';
import { getInstance } from '../lib/db.server.ts';

/** The Claude Code channel capability; the client drops the event unless it launched with the channel on. */
export const CHANNEL_CAPABILITY = 'claude/channel';
const CHANNEL_METHOD = 'notifications/claude/channel';

/** A result is inlined only as a teaser; the full row is one `get_run` (or `wait_for`) away. */
const RESULT_PREVIEW_CHARS = 600;

interface ChannelRegistry {
	/** Our own handle on the transport's GET streams: tmcp has no public way to notify one session. */
	streams: InMemoryStreamSessionManager;
	/** `session\0kind:id` pairs already armed, so repeat calls about one run don't stack pushes. */
	armed: Set<string>;
}

const globalForChannel = globalThis as unknown as { __codebayMcpChannel?: ChannelRegistry };
const registry: ChannelRegistry = (globalForChannel.__codebayMcpChannel ??= {
	streams: new InMemoryStreamSessionManager(),
	armed: new Set()
});

export function channelStreams(): InMemoryStreamSessionManager {
	return registry.streams;
}

function push(sessionId: string, content: string, meta: Record<string, string>): void {
	const frame = { jsonrpc: '2.0', method: CHANNEL_METHOD, params: { content, meta } };
	// A session with no open GET stream (or a client without the channel) just never sees it.
	registry.streams.send([sessionId], `event: message\ndata: ${JSON.stringify(frame)}\n\n`);
}

function runNotice(outcome: WaitOutcome): [string, Record<string, string>] | null {
	const { id, row } = outcome.runs[0]!;
	if (!row) return null;
	const sandbox = getInstance(row.instance_id);
	const facts = [
		row.num_turns != null ? `${row.num_turns} turns` : null,
		row.cost_usd != null ? `$${row.cost_usd.toFixed(2)}` : null
	].filter(Boolean);
	const lines = [
		`Agent run ${id} in sandbox "${sandbox?.name ?? row.instance_id}" finished: ${row.status}` +
			(facts.length ? ` (${facts.join(', ')})` : '') +
			'.'
	];
	if (row.error) lines.push(`Error: ${row.error}`);
	if (row.result) {
		const preview = row.result.length > RESULT_PREVIEW_CHARS;
		lines.push(`Result: ${row.result.slice(0, RESULT_PREVIEW_CHARS)}${preview ? '…' : ''}`);
	}
	lines.push(`Call get_run with run_id "${id}" for the full result.`);
	return [
		lines.join('\n'),
		{ kind: 'run', run_id: id, sandbox_id: row.instance_id, status: row.status }
	];
}

function sandboxNotice(outcome: WaitOutcome): [string, Record<string, string>] | null {
	const { id, row } = outcome.sandboxes[0]!;
	if (!row) return null;
	const content =
		row.status === 'running'
			? `Sandbox "${row.name}" (${id}) is running and ready for run_agent.`
			: `Sandbox "${row.name}" (${id}) did not come up: ${row.status}` +
				(row.error ? ` — ${row.error}` : '') +
				'. get_logs kind "boot" says why.';
	return [content, { kind: 'sandbox', sandbox_id: id, status: row.status }];
}

/**
 * Pushes a channel event to this MCP session once the run or sandbox settles. It rides the waiter
 * the other paths use, so nothing new polls; the listener lives until the target settles, which a
 * run's own timeout bounds. Lost on a manager restart, like the session itself.
 */
export function armChannel(
	sessionId: string | undefined,
	target: { run: string } | { sandbox: string }
): void {
	if (!sessionId) return;
	const kind = 'run' in target ? 'run' : 'sandbox';
	const id = 'run' in target ? target.run : target.sandbox;
	const key = `${sessionId}\0${kind}:${id}`;
	if (registry.armed.has(key)) return;
	registry.armed.add(key);
	const targets = kind === 'run' ? { runs: [id] } : { sandboxes: [id] };
	waitFor(targets, { timeoutMs: MAX_WAIT_MS })
		.then((outcome) => {
			if (!outcome.settled) return;
			const notice = kind === 'run' ? runNotice(outcome) : sandboxNotice(outcome);
			if (notice) push(sessionId, ...notice);
		})
		.catch(() => undefined)
		.finally(() => registry.armed.delete(key));
}
