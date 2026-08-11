# Codebay

**Codebay - the devcontainer manager** — a web UI for spinning up isolated devcontainer instances from any local folder or Git repo URL, each running Claude Code in a browser-based VS Code (`code-server`).

## Quick start

Requires [Bun](https://bun.sh) >= 1.3.13 (Node.js is not supported) and a running Docker daemon (Docker Desktop, Colima, OrbStack…) for the two devcontainer-backed modes. macOS and Linux are supported; Windows is untested.

```sh
bunx codebay@latest
```

The UI opens at `http://localhost:6969`. State (SQLite DB + per-instance workspace copies) lives in `~/.codebay`.

## Instance modes

Pick one per instance when you create it (or set the default in Settings):

| Mode          | Isolation                                  | What you get                                                          |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| **Full IDE**  | devcontainer (Docker)                      | Browser VS Code (`code-server`) with Claude Code, forwarded app ports |
| **Terminal**  | devcontainer (Docker)                      | Just Claude Code in a terminal — lighter, no code-server              |
| **Sandboxed** | [nono](https://nono.sh) sandbox, no Docker | Claude Code as a process on **this machine**, wrapped by nono         |

**Sandboxed** mode trades the container for an OS-level sandbox (macOS Seatbelt / Linux Landlock), so it starts in seconds with no image build and works with the Docker daemon stopped. Your folder is still copied into its own workspace under `DATA_DIR`, and Claude uses your host's existing `~/.claude` credentials.

It needs the `nono` CLI on your PATH:

```sh
brew install nono          # or: curl -fsSL https://nono.sh/install.sh | sh
```

Codebay installs the sandbox profile itself (`nono pull nolabs-ai/claude`) the first time you create a sandboxed instance. Change which pack it uses under **Settings → nono profile**.

Because the sandboxed terminal is a shell on the host rather than inside a container, codebay only attaches it for a browser on **this machine**, unless you set a `BASIC_AUTH_PASSWORD`. A remote client gets the reason printed in the terminal instead of a session. (The check is on the connecting client, not the bind address, so `HOST=0.0.0.0` — which `bun run dev` sets — still works locally.)

Ports, rebuilds and the health panel don't apply to this mode and are hidden.

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
