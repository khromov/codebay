# devcontainers-manager

A web UI for spinning up isolated devcontainer instances from any local folder for multiple simultaneous Claude Code workflows using the web version VS Code.

Pick a project folder → the app copies it, injects code-server into its `devcontainer.json`, runs `devcontainer up`, and publishes the editor on a unique host port. It also copies your host's Claude Code and GitHub CLI credentials into each container so `claude`, `gh`, and git-over-HTTPS work out of the box.

## Claude Code in your devcontainer

The app copies your Claude Code credentials and installs the attention hooks into every container, but it only copies them — it does **not** install the `claude` binary for projects that ship their own devcontainer.

- **Folders without a `devcontainer.json`** — the app generates a default config and automatically adds the [official Claude Code feature](https://github.com/anthropics/devcontainer-features), so `claude` is ready to use.
- **Folders that ship their own `.devcontainer/devcontainer.json`** — you are responsible for making sure `claude` is available in the image. The manager respects your config and won't modify your tooling. The simplest way is to add the feature:

  \`\`\`jsonc
  // .devcontainer/devcontainer.json
  {
  "features": {
  "ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}
  }
  }
  \`\`\`

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

- [Bun](https://bun.sh) >= 1.3.13 (Node.js is not supported)
- Docker (eg. Docker Desktop or Colima)

## Setup

\`\`\`sh
bun install
\`\`\`

## Commands

\`\`\`sh
bun run dev # dev server (local DATA_DIR, no browser launch)
bun run start # run the app
bun run build # production build → .mochi/
bun run typecheck # svelte-check + tsc --noEmit
bun test # run tests
\`\`\`

## Configuration

- `PORT` — server port (default `3333`)
- `DATA_DIR` — where state lives (default `~/.devcontainers-manager`)
- `DOCKER_HOST` — Docker daemon socket/URL to connect to (e.g. `unix://$HOME/.colima/default/docker.sock` or `tcp://1.2.3.4:2375`); defaults to your active Docker context
- `BASIC_AUTH_PASSWORD` — enables HTTP Basic Auth over the whole UI (disabled when unset)
- `DCM_CLAUDE_CODE_TOKEN` — inject this Claude Code OAuth token into every container instead of discovering the host's credentials (e.g. from `claude setup-token`)
- `DCM_GITHUB_TOKEN` — inject this GitHub token into every container instead of reading `gh auth token` from the host
- `DISABLE_OPEN_BROWSER=1` — skip opening the browser on startup
