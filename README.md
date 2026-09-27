# Codebay

**Codebay - the devcontainer manager** — a web UI for spinning up isolated devcontainer instances from any local folder or Git repo URL, each running Claude Code in a browser-based VS Code (`code-server`).

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
- `CODEBAY_GITHUB_TOKEN` — GitHub token to inject instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup

## MCP server

Codebay can expose itself to other AI agents over [MCP](https://modelcontextprotocol.io), so an agent
can spin up a sandbox, run Claude Code in it non-interactively, and read back the result.

It is **off by default**. Turn it on under Settings → **MCP server**, then copy the registration line
it shows you:

```sh
claude mcp add --transport http codebay http://localhost:6969/mcp \
  --header "Authorization: Bearer <token>"
```

The endpoint is `/mcp`. It returns `404` while disabled and `401` without a valid bearer token, and
it is the one place that does not use `BASIC_AUTH_PASSWORD` — MCP clients send the token instead.

The tools cover the whole loop: `create_sandbox`, `run_agent`, `get_run`, `wait_for`, `list_runs`, `stop_run`,
`get_diff`, `read_file`, `write_file`, `exec_command`, `git_push`, `create_pr`, `get_logs`,
`list_sandboxes`, `get_sandbox`, `rename_sandbox`, `stop_sandbox`, `start_sandbox`,
`rebuild_sandbox`, `add_port_forward`, `remove_port_forward` and `delete_sandbox`. Runs are
asynchronous — `run_agent` hands back a run id and the work continues in the background, surviving a
manager restart. `stop_sandbox` / `start_sandbox` cycle the container without losing the workspace,
and `rebuild_sandbox` recreates it (which is what applies a port forward).

### Being told when a run finishes

Callers don't have to poll `get_run`. There are three ways to find out that a run is done (or has
failed or been cancelled), or that a sandbox has finished building:

- **`wait_for`** blocks until the given runs/sandboxes settle and returns their final state. Pass
  several run ids with `mode: "any"` to handle parallel runs one at a time as they land. Codebay
  streams progress and SSE keepalives while it waits, so a long wait isn't cut off. In an
  interactive Claude Code session, a call that runs past about two minutes moves to the background
  and the model is told when it returns.
- **A background `curl`.** `run_agent`, `create_sandbox` and `rebuild_sandbox` return
  `wait.command`, a `curl` that blocks on `GET /mcp/wait` and prints the final JSON. The agent starts
  it with Bash `run_in_background` and gets notified when it exits. The URL carries an HMAC signature
  scoped to those ids, not the bearer token, and `--retry-all-errors` carries it through a manager
  restart. This works with any stock client that has a background shell.
- **A Claude Code channel (opt-in, research preview).** Codebay advertises the `claude/channel`
  capability and pushes a `<channel source="codebay">` event into the session that started or waited
  on a run, even while that session is idle. Claude Code only accepts it in an interactive session
  launched like this:

  ```sh
  MCP_PROTOCOL_NEGOTIATION=legacy claude --dangerously-load-development-channels server:codebay
  ```

  The environment variable matters: over HTTP, Claude Code otherwise negotiates the 2026-07-28
  protocol, which has no session to push to, and drops the channel. Channels also require
  claude.ai or Console authentication (not Bedrock or Vertex), and they don't work in `-p` mode.

Sandboxes created this way are ordinary instances: they show up on the dashboard with a live
"agent running" line, and you can open the IDE to watch. They persist until an agent (or you)
deletes them.

> **Anything holding the token can create containers and run agents with your GitHub and Claude
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

The repo also ships a Bun devcontainer (`.devcontainer/`) for a containerized setup; it runs a nested Docker daemon, so codebay itself can boot instances from inside it. New to authoring devcontainers? See the general [Devcontainer guide](./DEVCONTAINER_GUIDE.md).

## License

MIT
