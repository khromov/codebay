import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { HttpTransport } from '@tmcp/transport-http';
import type * as v from 'valibot';
import { APP_VERSION } from '../lib/config.server.ts';
import { MCP_PATH } from '../lib/mcp-auth.server.ts';
import { registerTools } from './tools.server.ts';
import { CHANNEL_CAPABILITY, channelStreams } from './channel.server.ts';
import type { McpContext } from './payloads.server.ts';

const INSTRUCTIONS = `Codebay runs isolated devcontainer sandboxes, each with an authenticated Claude Code inside it.

The normal flow is: create_sandbox (from a Git URL or a local folder) → wait for its status to be
"running" → run_agent with a prompt → wait for the run to finish → get_diff to see what changed →
git_push / create_pr to land it.

Never poll get_sandbox or get_run in a loop. Waiting is event-driven, three ways:
- wait_for blocks until the given runs/sandboxes settle and returns their final state. Long waits are
  fine: Codebay streams progress so the call is not cut off, and Claude Code moves a call that runs
  past a couple of minutes to the background and tells you when it returns.
- run_agent, create_sandbox and rebuild_sandbox return wait.command, a curl that blocks until the
  same thing and prints the final JSON. Start it with Bash run_in_background: true and carry on; you
  are notified when it exits. One per run is the easy way to track several runs at once.
- If this session was started with the Codebay channel enabled, a <channel source="codebay"> event
  arrives by itself when a run you started or waited on finishes, or a sandbox you created comes up.
  Its meta carries kind, run_id / sandbox_id and status; call get_run for the full result.

Sandboxes are persistent and cost real resources: stop_sandbox one you will come back to (its
workspace and run history stay; start_sandbox brings it back) and delete_sandbox one you are finished
with. rebuild_sandbox recreates the container from the devcontainer config, keeping the workspace —
it is what applies add_port_forward / remove_port_forward.
A sandbox runs one agent at a time. Runs are asynchronous: run_agent returns a handle immediately and
the work continues in the background, so never assume a run has finished before a wait says so.`;

/** Built once and pinned, so dev-mode hot reload doesn't drop live MCP sessions on the floor. */
interface McpRegistry {
	transport: HttpTransport<McpContext>;
}

const globalForMcp = globalThis as unknown as { __codebayMcp?: McpRegistry };

function build(): McpRegistry {
	const server = new McpServer<v.GenericSchema, McpContext>(
		{
			name: 'codebay',
			version: APP_VERSION,
			description: 'Create devcontainer sandboxes and run Claude Code in them.'
		},
		{
			adapter: new ValibotJsonSchemaAdapter(),
			instructions: INSTRUCTIONS,
			capabilities: {
				tools: { listChanged: false },
				// Harmless to clients that don't know it; lets Claude Code register the push channel.
				experimental: { [CHANNEL_CAPABILITY]: {} }
			}
		}
	);
	registerTools(server);
	return {
		transport: new HttpTransport(server, {
			path: MCP_PATH,
			// The bearer token is for programmatic clients; no browser page should be reaching this.
			allowedOrigins: [],
			cors: false,
			sessionManager: { streams: channelStreams() }
		})
	};
}

export function mcpTransport(): HttpTransport<McpContext> {
	return (globalForMcp.__codebayMcp ??= build()).transport;
}
