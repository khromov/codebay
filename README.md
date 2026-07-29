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
- `BASIC_AUTH_PASSWORD` — enables HTTP Basic Auth over the whole UI (disabled when unset); required if you bind beyond loopback with `HOST=0.0.0.0`
- `CODEBAY_CLAUDE_CODE_TOKEN` — Claude Code token to inject into every container (e.g. from `claude setup-token`) instead of discovering the host's credentials
- `CODEBAY_GITHUB_TOKEN` — GitHub token to inject instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup

## Development

```sh
bun install
bun run dev        # dev server, local ./.codebay DATA_DIR, no browser launch
bun run checks     # format + typecheck + tests
```

## License

MIT
