# Codebay

**Codebay - the devcontainer manager** — a web UI for spinning up isolated devcontainer instances from any local folder or Git repo URL, running Claude Code, Codex, or both in a browser-based VS Code (`code-server`) or terminal.

## Quick start

Requires [Bun](https://bun.sh) >= 1.3.13 (Node.js is not supported) and a running Docker daemon (Docker Desktop, Colima, OrbStack…). macOS, Linux and Windows are supported.

On Windows, Docker Desktop must use its **WSL2 backend**, so the workspace copies under `%USERPROFILE%\.codebay\` can be bind-mounted into the Linux daemon. Symlinks in a source folder are copied as regular files rather than recreated, because Windows only permits creating them under Developer Mode — the same thing Git for Windows does by default.

```sh
bunx codebay@latest
```

The UI opens at `http://localhost:6969`. State (SQLite DB + per-instance workspace copies) lives in `~/.codebay`.

## Configuration

- `PORT` — server port (default `6969`)
- `DATA_DIR` — where state lives (default `~/.codebay`)
- `DOCKER_HOST` — Docker socket/URL (defaults to your active Docker context)
- `HOST` — bind address (default `127.0.0.1`). Set `0.0.0.0` to reach codebay from other machines; your instances' forwarded app ports are then published on all interfaces too. Each container's code-server port stays loopback-only regardless — it runs without a password of its own and is reached through the Basic-Auth-gated `/p/:id/` proxy instead. Existing instances need a **Restart** to pick up the new binding.
- `PUBLIC_ORIGIN` — the origin you actually load codebay from (default `http://localhost:<PORT>`). Every form POST — creating an instance, restarting one, saving settings — is checked against it, so reaching the UI at any other address (a LAN IP, a hostname, or a reverse proxy / tunnel that terminates TLS) makes those actions fail with a `403 Cross-site POST form submissions are forbidden` until you set this. Give the exact scheme + host + port your browser shows, with no trailing slash — `PUBLIC_ORIGIN=http://192.168.1.50:6969` or `PUBLIC_ORIGIN=https://codebay.example.com`. Behind a TLS-terminating proxy this is the public `https://` URL, not the loopback address the proxy forwards to.
- `TRUSTED_ORIGINS` — comma-separated extra origins accepted alongside `PUBLIC_ORIGIN`, for when the UI is legitimately reachable at more than one address (e.g. `http://localhost:6969,http://192.168.1.50:6969`)
- `BASIC_AUTH_PASSWORD` — enables HTTP Basic Auth over the whole UI (disabled when unset); required if you bind beyond loopback with `HOST=0.0.0.0`
- `CODEBAY_CLAUDE_CODE_TOKEN` — Claude Code token to inject into every container (e.g. from `claude setup-token`) instead of discovering the host's credentials
- `CODEBAY_OPENAI_API_KEY` — OpenAI API key for Codex; falls back to `OPENAI_API_KEY`, then the host Codex login. A key saved in Settings takes precedence.
- `CODEX_HOME` — host Codex configuration directory (default `~/.codex`); can also be overridden in Settings
- `CODEBAY_GITHUB_TOKEN` — GitHub token to inject instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup

## Agents and settings

Settings → **Agents** selects **Claude** (the default), **Codex**, or **Claude and Codex**.
New containers install the selected agents; existing containers adopt the selection when rebuilt.
With both enabled, choose the preferred agent when creating a sandbox or change it on the sandbox's
settings page without rebuilding. Only the preferred agent launches automatically. Each agent has
its own persistent terminal session, so switching preserves the other session; open another console
and run `claude` or `codex` to use both at once.

Claude and Codex have separate credentials, model, reasoning, output, permissions, and custom
endpoint settings. GitHub credentials and environment settings are shared under **Git & environment**.
General, MCP, Appearance, and Advanced settings have their own sections.

Codex imports the host's file-backed login (or macOS Keychain login), portable model/display
preferences, `AGENTS.md`, `AGENTS.override.md`, rules, and skills from `CODEX_HOME`, plus
`~/.agents/skills`. A saved API key can replace host login; if no login can be exported, run
`codex login --device-auth` in the container. Host files are never modified. Custom endpoints must
implement the Responses API and use the model ID and API key configured for Codex.

Both agents support terminal and IDE surfaces, health checks, attention notifications, captured
transcripts, and MCP runs. Codex uses its native status line, reasoning effort, and response verbosity.
Full access inside the container is the default for both agents; Codex also offers workspace-write
and read-only modes. Codex's IDE extension is installed from Open VSX in IDE mode.

## MCP server

Codebay can expose itself to other AI agents over [MCP](https://modelcontextprotocol.io), so an agent
can spin up a sandbox, run Claude Code or Codex in it non-interactively, and read back the result.

It is **off by default**. Turn it on under Settings → **MCP server**, then copy the registration line
it shows you:

```sh
claude mcp add --transport http codebay http://localhost:6969/mcp \
  --header "Authorization: Bearer <token>"
```

For a Codex client:

```sh
export CODEBAY_MCP_TOKEN="<token>"
codex mcp add codebay --url http://localhost:6969/mcp \
  --bearer-token-env-var CODEBAY_MCP_TOKEN
```

Keep `CODEBAY_MCP_TOKEN` in the environment whenever you launch that client (in PowerShell, use
`$env:CODEBAY_MCP_TOKEN = "<token>"`). Settings provides copy buttons for both clients.

The endpoint is `/mcp`. It returns `404` while disabled and `401` without a valid bearer token, and
it is the one place that does not use `BASIC_AUTH_PASSWORD` — MCP clients send the token instead.

The tools cover the whole loop: `create_sandbox`, `run_agent`, `get_run`, `list_runs`, `stop_run`,
`get_diff`, `read_file`, `write_file`, `exec_command`, `git_push`, `create_pr`, `get_logs`,
`list_sandboxes`, `get_sandbox` and `delete_sandbox`. Runs are asynchronous — `run_agent` hands back
a run id and the work continues in the background, surviving a manager restart.

`create_sandbox` and `run_agent` accept `agent: "claude" | "codex"`; omission uses the sandbox's
preferred agent. Runs retain their agent even if that preference changes. Both support prompts,
model overrides, session resume, structured JSON output, timeout, cancellation, and live timelines.
Only one MCP run can be active per sandbox. Codex reports native token usage and leaves dollar cost
unset; Claude-only `max_turns` and `permission_mode` are rejected for Codex. Use
`codex_permission_mode` and `reasoning_effort` for Codex. Unattended Codex runs never wait for
interactive permission approval; restricted modes reject actions outside their sandbox.

Sandboxes created this way are ordinary instances: they show up on the dashboard with a live
"agent running" line, and you can open the IDE to watch. They persist until an agent (or you)
deletes them.

> **Anything holding the token can create containers and run agents with your GitHub and enabled agent
> credentials, with permission prompts bypassed inside the container.** Treat it like a password, and
> regenerate it from Settings if it leaks.

## Troubleshooting

- `403 Cross-site POST form submissions are forbidden` when clicking anything that saves — codebay is being reached at an origin other than `http://localhost:<PORT>`. Set `PUBLIC_ORIGIN` to the URL in your browser's address bar and restart (see Configuration).
- `warn: incorrect peer dependency "svelte@5.56.8"` on startup — harmless. It comes from `svelte-french-toast`, whose published peer range predates Svelte 5; the library works correctly on Svelte 5. Nothing to fix.

## Development

```sh
bun install
bun run dev        # dev server, local ./.codebay DATA_DIR, no browser launch
bun run checks     # format + typecheck + tests
```

The repo also ships a minimal Bun devcontainer (`.devcontainer/`) for a containerized setup. New to authoring devcontainers? See the general [Devcontainer guide](./DEVCONTAINER_GUIDE.md).

## License

MIT
