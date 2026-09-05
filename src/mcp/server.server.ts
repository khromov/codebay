import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { HttpTransport } from '@tmcp/transport-http';
import type * as v from 'valibot';
import { APP_VERSION } from '../lib/config.server.ts';
import { MCP_PATH } from '../lib/mcp-auth.server.ts';
import { registerTools } from './tools.server.ts';

const INSTRUCTIONS = `Codebay runs isolated devcontainer sandboxes, each with an authenticated Claude Code inside it.

The normal flow is: create_sandbox (from a Git URL or a local folder) → poll get_sandbox until its
status is "running" → run_agent with a prompt → poll get_run until it is done → get_diff to see what
changed → git_push / create_pr to land it.

Sandboxes are persistent and cost real resources, so delete_sandbox when you are finished with one.
A sandbox runs one agent at a time. Runs are asynchronous: run_agent returns a handle immediately and
the work continues in the background, so never assume a run has finished without checking get_run.`;

/** Built once and pinned, so dev-mode hot reload doesn't drop live MCP sessions on the floor. */
interface McpRegistry {
	transport: HttpTransport;
}

const globalForMcp = globalThis as unknown as { __codebayMcp?: McpRegistry };

function build(): McpRegistry {
	const server = new McpServer<v.GenericSchema>(
		{
			name: 'codebay',
			version: APP_VERSION,
			description: 'Create devcontainer sandboxes and run Claude Code in them.'
		},
		{
			adapter: new ValibotJsonSchemaAdapter(),
			instructions: INSTRUCTIONS,
			capabilities: { tools: { listChanged: false } }
		}
	);
	registerTools(server);
	return {
		transport: new HttpTransport(server, {
			path: MCP_PATH,
			// The bearer token is for programmatic clients; no browser page should be reaching this.
			allowedOrigins: [],
			cors: false
		})
	};
}

export function mcpTransport(): HttpTransport {
	return (globalForMcp.__codebayMcp ??= build()).transport;
}
