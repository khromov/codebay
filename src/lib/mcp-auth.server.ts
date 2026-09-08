import { randomBytes } from 'node:crypto';
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
