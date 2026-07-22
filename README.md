# Codebay

**devcontainer manager** — a web UI for spinning up isolated devcontainer instances from any local folder for multiple simultaneous Claude Code workflows using the web version VS Code.

Pick a project folder → the app copies it, injects code-server into its `devcontainer.json`, runs `devcontainer up`, and publishes the editor on a unique host port. It also copies your host's Claude Code and GitHub CLI credentials into each container so `claude`, `gh`, and git-over-HTTPS work out of the box.

## Quick start

```sh
bunx codebay@latest
```

That's it — no checkout, no install. It opens `http://localhost:6969` in your browser, keeps
its state in `~/.codebay`, and binds to loopback only. Requires [Bun](https://bun.sh) >= 1.3.14
and a running Docker daemon. Set `BASIC_AUTH_PASSWORD` (and `HOST=0.0.0.0`) if you want to
reach it from another machine.

## Claude Code in your devcontainer

The app copies your Claude Code credentials and installs the attention hooks into every container, but it only copies them — it does **not** install the `claude` binary for projects that ship their own devcontainer.

- **Folders without a `devcontainer.json`** — the app generates a default config and automatically adds the [official Claude Code feature](https://github.com/anthropics/devcontainer-features), so `claude` is ready to use.
- **Folders that ship their own `.devcontainer/devcontainer.json`** — you are responsible for making sure `claude` is available in the image. The manager respects your config and won't modify your tooling. The simplest way is to add the feature:

  ```jsonc
  // .devcontainer/devcontainer.json
  {
  	"features": {
  		"ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}
  	}
  }
  ```

  (The feature installs Node.js if it isn't already present.) Alternatively, install it yourself in your Dockerfile, e.g. `npm install -g @anthropic-ai/claude-code`.

## Container injections

After `devcontainer up`, the app installs a few things into each container. Each is a self-contained module under `src/container-injections/` (add or remove one by editing that directory's registry):

- **git safe.directory** — marks the copied workspace as a safe git directory for the container user, so git doesn't reject the host-owned `.git` as "dubious ownership".
- **git identity** — copies your host's global `git config user.name`/`user.email` so commits made inside the container are attributed to you, instead of failing or landing as `root@<container>`.
- **Claude Code** — copies your host's Claude Code OAuth credentials so the in-container `claude` is signed in without a fresh login.
- **GitHub CLI** — copies your host's GitHub token so `gh` and git-over-HTTPS push/pull are authenticated.
- **Claude attention hooks** — installs Claude hooks that ping the manager when Claude finishes a task or needs input, pulsing the instance's IDE tab.
- **claude alias** — aliases the in-container `claude` to `claude --dangerously-skip-permissions`, since every instance is a throwaway, single-tenant sandbox where the permission prompts add friction without adding real protection.

## Requirements

- macOS and Linux are supported (Windows is untested — feel free to [open an issue](../../issues))
- [Bun](https://bun.sh) >= 1.3.14 (Node.js is not supported)
- Docker (eg. Docker Desktop or Colima)

## Run from source

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
4. Open `http://localhost:6969` and log in as `admin` with that password.

### Run the published image

The easiest way to run it is the bundled [`docker-compose.yml`](./docker-compose.yml):

```sh
export BASIC_AUTH_PASSWORD=change-me
export CODEBAY_DATA_DIR=/opt/codebay        # Linux; on Mac use a path under $HOME (see below)
export CODEBAY_GITHUB_TOKEN=$(gh auth token)
export CODEBAY_CLAUDE_CODE_TOKEN=$(claude setup-token)   # optional
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

- `PORT` — server port (default `6969`)
- `DATA_DIR` — where state lives (default `~/.codebay`)
- `DOCKER_HOST` — Docker daemon socket/URL to connect to (e.g. `unix://$HOME/.colima/default/docker.sock` or `tcp://1.2.3.4:2375`); defaults to your active Docker context
- `BASIC_AUTH_PASSWORD` — enables HTTP Basic Auth over the whole UI (disabled when unset)
- `MOCHI_KEY` — base64url-encoded 32-byte secret; set it for persistent deployments so signed image URLs and island props survive restarts (a random key is generated when unset)
- `CODEBAY_CLAUDE_CODE_TOKEN` — inject this Claude Code OAuth token into every container instead of discovering the host's credentials (e.g. from `claude setup-token`)
- `CODEBAY_GITHUB_TOKEN` — inject this GitHub token into every container instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup
