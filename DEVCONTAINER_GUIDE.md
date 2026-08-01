# Devcontainer guide

Codebay's world has **two different kinds of devcontainer**, and it's easy to confuse them:

1. **The repo's own `.devcontainer/`** — a [devcontainer](https://containers.dev/) for _developing Codebay itself_. Open the repo in VS Code (or any devcontainer-compatible editor) → "Reopen in Container" and you get a ready-to-hack environment. **This guide is about this one.**
2. **The per-instance devcontainers Codebay generates at runtime** — when you spin up an instance, Codebay copies/clones a source, injects code-server + a bunch of tooling into _that project's_ `devcontainer.json`, and runs `devcontainer up`. Those are described in [`CLAUDE.md`](./CLAUDE.md) (see "Instance lifecycle" and "Container injections"); they are **not** what this file documents.

## The dev devcontainer

`.devcontainer/devcontainer.json`:

```jsonc
{
	"name": "Codebay",
	"image": "mcr.microsoft.com/devcontainers/base:ubuntu",
	"features": {
		"ghcr.io/shyim/devcontainers-features/bun:0": {},
		"ghcr.io/devcontainers/features/github-cli:1": {},
		"ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}
	},
	"forwardPorts": [6969],
	"portsAttributes": {
		"6969": { "label": "codebay", "onAutoForward": "notify" }
	},
	"postCreateCommand": "bun install",
	"customizations": {
		"vscode": {
			"extensions": ["svelte.svelte-vscode", "dbaeumer.vscode-eslint", "esbenp.prettier-vscode"],
			"settings": {
				"editor.formatOnSave": true,
				"editor.defaultFormatter": "esbenp.prettier-vscode"
			}
		}
	}
}
```

It's intentionally minimal — inspired by [Mochi's devcontainer](https://github.com/khromov/mochi/tree/main/.devcontainer) but stripped of the firewall, custom Dockerfile, and code-server launcher that setup carries.

### Why each piece is there

- **`mcr.microsoft.com/devcontainers/base:ubuntu`** — a plain Ubuntu base with the standard `vscode` user, git, and common tooling. No custom Dockerfile to maintain.
- **Bun feature** (`ghcr.io/shyim/devcontainers-features/bun`) — Codebay runs on **Bun only** (Node.js is not supported for running the app). Bun installs to `/usr/local/bin/bun`. The feature tracks latest Bun; the repo's floor is `bun >= 1.3.14` (`engines` in `package.json`, `.bun-version`), which latest satisfies.
- **GitHub CLI feature** — `gh` for PRs, issues, and the release-please flow. Codebay also reads `gh auth token` on the host when injecting GitHub credentials into instances, so it's a natural fit.
- **Claude Code feature** (`ghcr.io/anthropics/devcontainer-features/claude-code`) — installs the `claude` CLI globally. **This is not optional in practice:** when Codebay boots an instance it _injects_ Claude credentials, aliases, attention hooks, and a statusLine, but it never installs the `claude` binary itself — it assumes one is already present. Without this feature you get `claude: command not found` in the terminal even though everything else is wired up. The feature also **installs Node.js when it's missing** (Claude Code is an npm package), so no separate `node` feature is needed, and it contributes the `anthropic.claude-code` VS Code extension automatically.
- **`forwardPorts: [6969]`** — Codebay's default `PORT`. This is the one port forward the dev environment actually needs: `bun run dev` serves the UI on `6969`, and forwarding it makes `http://localhost:6969` reachable on the host. The `portsAttributes` label just makes it show up as "codebay" in the Ports panel.
- **`postCreateCommand: bun install`** — installs dependencies once on create so the container is ready to run.
- **VS Code customizations** — Svelte, ESLint, and Prettier extensions with format-on-save, matching the repo's `bun run checks` (which runs `format` first).

### What it deliberately does _not_ include

- **No Docker access.** Codebay's job is orchestrating Docker containers, but this dev devcontainer is **Bun-only**: no host Docker socket, no docker-in-docker. You can edit, typecheck, test, format, and run the server, but you can't spawn instances from inside the container. This keeps the setup minimal and sidesteps the docker-outside-of-docker networking gotcha (child containers publish their ports on the _host's_ loopback, which the dev container can't reach at `127.0.0.1`). Do full instance-orchestration work on the host, or on a machine with a real daemon.
- **No firewall / no custom Dockerfile.** Both add complexity this environment doesn't need.

## Testing strategy & Docker

The automated suite is **fully self-contained and needs no Docker daemon** — even `src/lib/docker.isolated.test.ts` stubs dockerode by seeding `globalThis.__codebayDocker` with a fake client. So:

```sh
bun run checks   # format + typecheck + tests — always runs, Docker or not
```

works inside this Bun-only devcontainer with everything green.

Only **end-to-end verification of the instance lifecycle** — actually creating an instance, `devcontainer up`, the boot/health flow — needs a **live daemon**. Before attempting that, probe first:

```sh
docker info        # or: docker context inspect
```

If Docker isn't available (as in this devcontainer), don't try to boot instances — rely on the unit/isolated tests, which cover the orchestration logic against stubs. When Docker _is_ running, live-boot verification becomes an option on top of the suite. (This same guidance lives in `CLAUDE.md`.)

## Using it

1. Open the repo in VS Code with the **Dev Containers** extension (or a compatible editor).
2. **Reopen in Container** (Command Palette → "Dev Containers: Reopen in Container"). First build installs the features and runs `bun install`.
3. Run the app:

   ```sh
   bun run dev      # MODE=development, local ./.codebay DATA_DIR, no browser launch
   ```

   Open `http://localhost:6969` (port `6969` is forwarded).

4. Before considering any change done:

   ```sh
   bun run checks   # format, typecheck, tests
   ```

If you change `.devcontainer/devcontainer.json`, rebuild the container ("Dev Containers: Rebuild Container") to pick it up.
