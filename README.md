# Codebay

**Codebay - the devcontainer manager** — a web UI for spinning up isolated devcontainer instances from any local folder or Git repo URL, each running Claude Code in a browser-based VS Code (`code-server`).

## Quick start

Requires [Bun](https://bun.sh) >= 1.3.13 (Node.js is not supported) and a running Docker daemon (Docker Desktop, Colima, OrbStack…). macOS and Linux are supported; Windows is untested.

```sh
bunx codebay@latest
```

The UI opens at `http://localhost:6969`. State (SQLite DB + per-instance workspace copies) lives in `~/.codebay`.

## Configuration

- `PORT` — server port (default `6969`)
- `DATA_DIR` — where state lives (default `~/.codebay`)
- `DOCKER_HOST` — Docker socket/URL (defaults to your active Docker context)
- `HOST` — bind address (default `127.0.0.1`). Set `0.0.0.0` to reach codebay from other machines; your instances' forwarded app ports are then published on all interfaces too. Each container's code-server port stays loopback-only regardless — it runs without a password of its own and is reached through the Basic-Auth-gated `/p/:id/` proxy instead. Existing instances need a **Restart** to pick up the new binding.
- `BASIC_AUTH_PASSWORD` — enables HTTP Basic Auth over the whole UI (disabled when unset); required if you bind beyond loopback with `HOST=0.0.0.0`
- `CODEBAY_CLAUDE_CODE_TOKEN` — Claude Code token to inject into every container (e.g. from `claude setup-token`) instead of discovering the host's credentials
- `CODEBAY_GITHUB_TOKEN` — GitHub token to inject instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup

## Troubleshooting

- `warn: incorrect peer dependency "svelte@5.56.8"` on startup — harmless. It comes from `svelte-french-toast`, whose published peer range predates Svelte 5; the library works correctly on Svelte 5. Nothing to fix.

## Development

```sh
bun install
bun run dev        # dev server, local ./.codebay DATA_DIR, no browser launch
bun run checks     # format + typecheck + tests
```

## License

MIT
