import { Mochi, apiError, type MochiRouteValue } from 'mochi-framework';
import { MCP_PATH, mcpAuthOk, mcpEnabled } from '../lib/mcp-auth.server.ts';
import { mcpTransport } from './server.server.ts';

function unauthorized(): Response {
	return new Response('Unauthorized', {
		status: 401,
		headers: { 'WWW-Authenticate': 'Bearer realm="Codebay MCP"' }
	});
}

/**
 * Mounted at `/mcp` rather than under `/api/` on purpose: `basicAuth` 403s every mutating `/api/`
 * request without the `x-codebay-request` header, which no MCP client sends. The path is exempt
 * from the Basic Auth gate and the CSRF filter, and authenticates by bearer token instead — the
 * same trade the container bridge makes.
 */
export const mcpRoutes: Record<string, MochiRouteValue> = {
	[MCP_PATH]: Mochi.api(async ({ request }) => {
		// A 404 while disabled, so an install that never opted in looks like it has no MCP at all.
		if (!mcpEnabled()) return apiError(404, 'Not Found');
		if (!mcpAuthOk(request)) return unauthorized();
		return (await mcpTransport().respond(request)) ?? apiError(404, 'Not Found');
	})
};
