import { createHmac, randomBytes } from 'node:crypto';
import { getOption, setOption } from './db.server.ts';
import { timingSafeEqualStr } from './crypto.server.ts';

/** The MCP endpoint's path; `auth.server.ts` and the CSRF filter both key off this exact value. */
export const MCP_PATH = '/mcp';

export const MCP_ENABLED_KEY = 'mcp_enabled';
export const MCP_TOKEN_KEY = 'mcp_token';

/**
 * Off until someone opts in. The token gates the endpoint, but an install that never wanted an
 * agent-facing control plane shouldn't expose one at all.
 */
export function mcpEnabled(): boolean {
	return getOption(MCP_ENABLED_KEY) === '1';
}

export function setMcpEnabled(enabled: boolean): void {
	setOption(MCP_ENABLED_KEY, enabled ? '1' : '0');
	if (enabled) getMcpToken();
}

function mint(): string {
	return `cb_${randomBytes(32).toString('base64url')}`;
}

/**
 * Minted on first read and persisted, so the settings page and the route can't disagree. Unlike
 * every other secret here this one is shown to the user in plaintext — copying it into an MCP
 * client is the whole point of it existing.
 */
export function getMcpToken(): string {
	const existing = getOption(MCP_TOKEN_KEY);
	if (existing) return existing;
	const token = mint();
	setOption(MCP_TOKEN_KEY, token);
	return token;
}

export function regenerateMcpToken(): string {
	const token = mint();
	setOption(MCP_TOKEN_KEY, token);
	return token;
}

/** Constant-time, like the bridge token check, so a wrong guess leaks nothing by timing. */
export function mcpAuthOk(request: Request): boolean {
	const header = request.headers.get('authorization');
	if (!header?.startsWith('Bearer ')) return false;
	return timingSafeEqualStr(header.slice(7).trim(), getMcpToken());
}

/** The completion long-poll; a sibling of `MCP_PATH` so it shares that path's auth exemptions. */
export const MCP_WAIT_PATH = `${MCP_PATH}/wait`;

/** Order-insensitive, so `runs=a,b` and `runs=b,a` share a signature. */
function waitScope(runs: readonly string[], sandboxes: readonly string[]): string {
	return `wait\nruns=${[...runs].sort().join(',')}\nsandboxes=${[...sandboxes].sort().join(',')}`;
}

/**
 * A read-only capability for one set of wait targets, keyed on the MCP token. It rides in the wait
 * command handed to the agent, so the transcript never carries the token that drives every tool;
 * rotating the token revokes every outstanding one.
 */
export function signWait(runs: readonly string[], sandboxes: readonly string[]): string {
	return createHmac('sha256', getMcpToken())
		.update(waitScope(runs, sandboxes))
		.digest('base64url')
		.slice(0, 32);
}

export function waitSigOk(
	sig: string | null,
	runs: readonly string[],
	sandboxes: readonly string[]
): boolean {
	return !!sig && timingSafeEqualStr(sig, signWait(runs, sandboxes));
}
