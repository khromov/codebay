import { sanitizeInstance } from '../lib/instances.server.ts';
import { listForwards, type AgentRunRow, type InstanceRow } from '../lib/db.server.ts';
import { runDetail } from '../lib/agent-runs.server.ts';
import { currentHealthSnapshots } from '../lib/health.server.ts';
import { proxyPathFor } from '../lib/proxy.server.ts';
import { PUBLIC_ORIGIN } from '../lib/config.server.ts';
import { MCP_WAIT_PATH, signWait } from '../lib/mcp-auth.server.ts';
import type { WaitOutcome, WaitTargets } from '../lib/waits.server.ts';

/** Per-request context the route hands the transport; tool handlers read it via `server.ctx.custom`. */
export type McpContext = {
	/** Where this client reached us, which is where a shell on the same machine can reach us too. */
	origin: string;
};

/** The IDE link is what makes a sandbox inspectable by a human, so every sandbox payload carries it. */
export const ideUrl = (id: string) => `${PUBLIC_ORIGIN}${proxyPathFor(id)}`;

export const healthFor = (id: string) =>
	currentHealthSnapshots().find((s) => s.id === id)?.health ?? null;

/** Forwards ride along because add/remove_port_forward hand back the sandbox as their receipt. */
export function sandboxPayload(row: InstanceRow) {
	const open = new Set(healthFor(row.id)?.openPorts ?? []);
	return {
		...sanitizeInstance(row),
		ide_url: ideUrl(row.id),
		forwarded_ports: listForwards(row.id).map((f) => ({
			container_port: f.container_port,
			host_port: f.host_port,
			open: open.has(f.container_port)
		}))
	};
}

/** The prompt is left out: the caller wrote it, and it can be as large as the carrier allows. */
export function runPayload(run: AgentRunRow) {
	const { id, instance_id, prompt: _prompt, ...detail } = runDetail(run);
	return { run_id: id, sandbox_id: instance_id, ...detail };
}

/** One shape for every wait answer, whether it arrives as a tool result or on the HTTP endpoint. */
export function waitPayload(outcome: WaitOutcome) {
	return {
		settled: outcome.settled,
		timed_out: outcome.timed_out,
		runs: outcome.runs.map(({ id, row }) =>
			row ? runPayload(row) : { run_id: id, status: 'deleted' as const }
		),
		sandboxes: outcome.sandboxes.map(({ id, row }) =>
			row ? sandboxPayload(row) : { id, status: 'deleted' as const }
		)
	};
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * A shell command that blocks until the targets settle and then prints the same JSON `wait_for`
 * returns. It carries a signed, read-only URL rather than the bearer token, and `--retry-all-errors`
 * rides out a manager restart: the heartbeats before the final document are bare whitespace, so a
 * retried request still leaves clean JSON on stdout.
 */
export function waitCommand(
	origin: string,
	targets: WaitTargets,
	mode: 'all' | 'any' = 'all'
): string {
	const runs = targets.runs ?? [];
	const sandboxes = targets.sandboxes ?? [];
	const params = new URLSearchParams();
	if (runs.length) params.set('runs', runs.join(','));
	if (sandboxes.length) params.set('sandboxes', sandboxes.join(','));
	if (mode === 'any') params.set('mode', 'any');
	params.set('sig', signWait(runs, sandboxes));
	const url = `${origin}${MCP_WAIT_PATH}?${params.toString().replaceAll('%2C', ',')}`;
	return `curl -sN --retry 60 --retry-delay 5 --retry-all-errors ${shellQuote(url)}`;
}

/** Rides on every response that starts something asynchronous, so the agent never has to poll. */
export function waitHint(origin: string, targets: WaitTargets, what: string) {
	return {
		command: waitCommand(origin, targets),
		how:
			`Run this command with your Bash tool in the background (run_in_background: true). It ` +
			`exits by itself when ${what}, printing the final state as JSON, and you are notified ` +
			`when it does — so carry on with other work instead of polling. No token is needed.`
	};
}
