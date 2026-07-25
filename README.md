# Codebay

**devcontainer manager** — a web UI for spinning up isolated devcontainer instances from any local folder for multiple simultaneous Claude Code or Codex workflows using the web version of VS Code.

Pick a project folder → choose Claude Code or Codex → the app copies it, injects code-server into its `devcontainer.json`, runs `devcontainer up`, and publishes the editor on a unique host port. It also injects the selected agent's credentials plus GitHub CLI credentials.

## Coding agents in your devcontainer

Claude Code is enabled by default. Codex can be enabled under Settings → Coding agents. When both are enabled, the new-instance picker asks which agent to use. That choice is saved on the instance, so later Settings changes do not alter existing instances or their rebuilds.

- **Folders without a `devcontainer.json`** — Codebay generates a default config and installs only the selected agent: the [official Claude Code feature](https://github.com/anthropics/devcontainer-features) for Claude, or `@openai/codex` for Codex.
- **Folders that ship their own `.devcontainer/devcontainer.json`** — you are responsible for making the selected CLI available. Codebay respects your tooling. For Claude, add its feature:

  ```jsonc
  // .devcontainer/devcontainer.json
  {
  	"features": {
  		"ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}
  	}
  }
  ```

  (The feature installs Node.js if it isn't already present.) Alternatively, install it yourself in your Dockerfile, e.g. `npm install -g @anthropic-ai/claude-code`.

  For Codex, install Node.js and `npm install -g @openai/codex`.

Codebay discovers Codex auth from `${CODEX_HOME:-~/.codex}/auth.json`. If Codex stores host credentials only in the OS keyring, Codebay cannot export them; use a manual OpenAI API key in Settings or set `CODEBAY_OPENAI_API_KEY`. Codebay copies only `auth.json`, never Codex configuration, history, sessions, skills, plugins, or other state.

## Container injections

After `devcontainer up`, the app installs a few things into each container. Each is a self-contained module under `src/container-injections/` (add or remove one by editing that directory's registry):

- **git safe.directory** — marks the copied workspace as a safe git directory for the container user, so git doesn't reject the host-owned `.git` as "dubious ownership".
- **git identity** — copies your host's global `git config user.name`/`user.email` so commits made inside the container are attributed to you, instead of failing or landing as `root@<container>`.
- **Agent auth** — injects Claude Code OAuth credentials for Claude instances, or file-backed Codex auth / an OpenAI API key for Codex instances.
- **GitHub CLI** — copies your host's GitHub token so `gh` and git-over-HTTPS push/pull are authenticated.
- **Agent attention hooks** — installs Claude or Codex lifecycle hooks that ping the manager when the agent finishes a task or needs input, pulsing the instance's IDE tab.
- **Agent alias** — launches Claude with `--dangerously-skip-permissions`, or Codex with `--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust`, because each agent runs inside its own isolated devcontainer.

## Requirements

- macOS and Linux are supported (Windows is untested — feel free to [open an issue](../../issues))
- [Bun](https://bun.sh) >= 1.3.13 (Node.js is not supported)
- Docker (eg. Docker Desktop or Colima)

## Setup

```sh
bun install
```

## Commands

```sh
bun run dev # dev server (local DATA_DIR, no browser launch)
bun run start # run the app
bun run build # production build → .mochi/
bun run typecheck # svelte-check + tsc --noEmit
bun test # run tests
```

## Run with Docker

Instead of running from source you can run the manager itself as a container that
drives your **host's** Docker daemon (Docker-out-of-Docker) — it spins the devcontainers
up as siblings on the host. A multi-arch image is published to GHCR:

```sh
docker pull ghcr.io/khromov/codebay:latest
```

### Build and run from the Dockerfile

To build the image yourself instead of pulling:

1. Build it (produces a production build — no local Bun needed):
   ```sh
   docker build -t codebay .
   ```
2. Point compose at your local image by editing `docker-compose.yml` — replace the
   `image:` line with `build: .` (or set `image: codebay`).
3. Start it:
   ```sh
   export BASIC_AUTH_PASSWORD=change-me
   export CODEBAY_DATA_DIR=/opt/codebay && mkdir -p "$CODEBAY_DATA_DIR"
   docker compose up -d
   ```
4. Open `http://localhost:3333` and log in as `admin` with that password.

### Run the published image

The easiest way to run it is the bundled [`docker-compose.yml`](./docker-compose.yml):

```sh
export BASIC_AUTH_PASSWORD=change-me
export CODEBAY_DATA_DIR=/opt/codebay        # Linux; on Mac use a path under $HOME (see below)
export CODEBAY_GITHUB_TOKEN=$(gh auth token)
export CODEBAY_CLAUDE_CODE_TOKEN=$(claude setup-token)   # optional
export CODEBAY_OPENAI_API_KEY=sk-...                     # optional, for Codex
mkdir -p "$CODEBAY_DATA_DIR"
docker compose up -d
```

Or the equivalent raw `docker run`:

```sh
docker run -d --name codebay --network host \
  -e BASIC_AUTH_PASSWORD=change-me \
  -e DATA_DIR=/opt/codebay \
  -e DOCKER_HOST=unix:///var/run/docker.sock \
  -e CODEBAY_GITHUB_TOKEN="$(gh auth token)" \
  -e CODEBAY_OPENAI_API_KEY \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/codebay:/opt/codebay \
  -v "$HOME/.gitconfig:/root/.gitconfig:ro" \
  -v "$HOME/projects:$HOME/projects:ro" \
  ghcr.io/khromov/codebay:latest
```

Two things are load-bearing:

- **`--network host`** — so the manager's in-app proxy (`127.0.0.1:<port>`) and the
  attention bridge (containers → `host.docker.internal`) reach the code-server instances.
  With host networking, `HOST=0.0.0.0` is required, so **always set `BASIC_AUTH_PASSWORD`**.
- **`DATA_DIR` at an identical host↔container path** — `devcontainer up` bind-mounts the
  copied workspace, and the daemon resolves that path on the host. The bind mount must map
  the same absolute path on both sides (`/opt/codebay:/opt/codebay`), and `DATA_DIR` must
  point at it.

**Linux vs. Mac:** on a Linux host with a native daemon, any `DATA_DIR` path works.
On **Docker Desktop / Colima** (Mac) the daemon runs in a VM that only sees auto-mounted
host paths, so put `CODEBAY_DATA_DIR` **under `$HOME`** (e.g. `$HOME/.codebay`); also note
`--network host` binds to the VM, so reach the UI via the VM rather than `localhost`.

## Configuration

- `PORT` — server port (default `3333`)
- `DATA_DIR` — where state lives (default `~/.codebay`)
- `DOCKER_HOST` — Docker daemon socket/URL to connect to (e.g. `unix://$HOME/.colima/default/docker.sock` or `tcp://1.2.3.4:2375`); defaults to your active Docker context
- `BASIC_AUTH_PASSWORD` — enables HTTP Basic Auth over the whole UI (disabled when unset)
- `MOCHI_KEY` — base64url-encoded 32-byte secret; set it for persistent deployments so signed image URLs and island props survive restarts (a random key is generated when unset)
- `CODEBAY_CLAUDE_CODE_TOKEN` — inject this Claude Code OAuth token into Claude instances instead of discovering the host's credentials (e.g. from `claude setup-token`)
- `CODEBAY_OPENAI_API_KEY` — sign Codex into Codex instances with this OpenAI API key instead of copying `${CODEX_HOME:-~/.codex}/auth.json`
- `CODEBAY_GITHUB_TOKEN` — inject this GitHub token into every container instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup
