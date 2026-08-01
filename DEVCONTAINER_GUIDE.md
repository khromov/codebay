# Devcontainer guide

A practical guide to authoring a [devcontainer](https://containers.dev/) for **any** application — a reproducible, containerized dev environment your editor (VS Code, and other devcontainer-compatible tools) builds and drops you into. This is a general reference, not specific to any one project.

## Why a devcontainer

- **Reproducible** — everyone gets the same toolchain, versions, and OS packages, regardless of their host.
- **Isolated** — project dependencies don't pollute the host, and vice versa.
- **Onboarding in one step** — "Reopen in Container" installs the runtime, tools, extensions, and dependencies for you.

## A minimal example

Everything lives in `.devcontainer/devcontainer.json` at the repo root:

```jsonc
{
	"name": "My App",
	"image": "mcr.microsoft.com/devcontainers/base:ubuntu",
	"features": {
		"ghcr.io/devcontainers/features/node:1": {}
	},
	"forwardPorts": [3000],
	"portsAttributes": {
		"3000": { "label": "app", "onAutoForward": "notify" }
	},
	"postCreateCommand": "npm install",
	"customizations": {
		"vscode": {
			"extensions": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode"],
			"settings": {
				"editor.formatOnSave": true
			}
		}
	}
}
```

That's a complete, working devcontainer. The rest of this guide explains each part and the choices behind it.

## The building blocks

### Base: `image` vs `build`

- **`image`** — start from a prebuilt image. Fastest and simplest. The `mcr.microsoft.com/devcontainers/base:*` images (`ubuntu`, `debian`, `alpine`) ship a non-root `vscode` user, git, and common CLI tooling — a good default.
- **`build.dockerfile`** — point at a local `Dockerfile` when you need custom system packages, a pinned toolchain baked into the image, or anything features can't express. More power, more to maintain.

Reach for `image` + features first. Only introduce a Dockerfile when a feature can't do the job.

### Features

[Features](https://containers.dev/features) are composable install units referenced by OCI address. They're the idiomatic way to add languages and tools without writing install scripts:

```jsonc
"features": {
  "ghcr.io/devcontainers/features/node:1": {},
  "ghcr.io/devcontainers/features/python:1": { "version": "3.12" },
  "ghcr.io/devcontainers/features/go:1": {},
  "ghcr.io/devcontainers/features/github-cli:1": {},
  "ghcr.io/devcontainers/features/docker-in-docker:2": {}
}
```

Notes that save you time:

- **Pin versions** where reproducibility matters — most features take a `version` option (`"version": "3.12"`).
- **Ordering & dependencies.** A feature can declare `installsAfter`, and the resolver orders things accordingly, so declaration order in your file usually doesn't matter. But dependencies aren't always inferred — see the gotcha below.
- **Community features exist** for things not in the official set (e.g. Bun via `ghcr.io/shyim/devcontainers-features/bun`). They're third-party — pin and vet them like any dependency.

### Add a feature's prerequisites explicitly

**A feature that tries to auto-install its own prerequisites can fail on some base images. When a feature depends on a runtime, add that runtime's feature explicitly rather than trusting the fallback.**

A concrete example: the Claude Code feature (`ghcr.io/anthropics/devcontainer-features/claude-code`) needs Node + npm. If Node is absent it tries to install it, but on the Ubuntu base its fallback pulls the distro `nodejs` package **without `npm`**, then fails its own `command -v npm` check and aborts the entire build:

```
ERROR: Node.js and npm are required but could not be installed!
Please add the Node.js feature to your devcontainer.json
```

The fix is to list the dependency feature yourself:

```jsonc
"features": {
  "ghcr.io/devcontainers/features/node:1": {},
  "ghcr.io/anthropics/devcontainer-features/claude-code:1.0": {}
}
```

The dependent feature's `installsAfter: node` still guarantees correct ordering — you're just making sure a working Node is present for it to run after. The general lesson: if a feature's install can silently depend on a runtime, declare that runtime.

### Forwarding ports

`forwardPorts` publishes a container port to your host so `http://localhost:<port>` reaches your app. `portsAttributes` labels each port and controls the notification behavior:

```jsonc
"forwardPorts": [3000],
"portsAttributes": {
  "3000": { "label": "app", "onAutoForward": "notify" }
}
```

Forward exactly the ports your dev server, API, or debugger listens on. (VS Code can also auto-detect and forward ports at runtime, but declaring them is explicit and works headless.)

### Installing dependencies: lifecycle commands

Run setup with the lifecycle hooks — they fire at different times:

- **`postCreateCommand`** — once, after the container is created. The place for `npm install` / `bun install` / `pip install -r requirements.txt`.
- **`postStartCommand`** — every time the container starts (e.g. launch a background service).
- **`onCreateCommand`** / **`updateContentCommand`** — earlier hooks used by prebuild systems.

```jsonc
"postCreateCommand": "npm install"
```

### Editor customizations

`customizations.vscode` seeds extensions and settings so the environment is consistent for everyone who opens it:

```jsonc
"customizations": {
  "vscode": {
    "extensions": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode"],
    "settings": { "editor.formatOnSave": true, "editor.defaultFormatter": "esbenp.prettier-vscode" }
  }
}
```

Some features contribute their own extensions automatically (the Claude Code feature adds `anthropic.claude-code`, for instance), so you don't always have to list them.

### Other fields worth knowing

- **`remoteUser`** — the user commands run as (`vscode` on the base images; `node` on `node:*`, etc.).
- **`containerEnv`** — environment variables baked into the container.
- **`mounts`** / **`workspaceMount`** — bind or volume mounts, e.g. to persist shell history or a tool's config across rebuilds.
- **`runArgs`** — extra `docker run` flags (e.g. `--add-host=host.docker.internal:host-gateway`).

## If your app needs Docker

When the app under development itself talks to a Docker daemon (builds images, spawns containers), give the devcontainer Docker access with one of:

- **`docker-outside-of-docker`** — mounts the **host's** Docker socket; containers your app creates are siblings on the host daemon.
- **`docker-in-docker`** — runs a **nested** daemon inside the devcontainer; fully isolated but heavier.

```jsonc
"features": { "ghcr.io/devcontainers/features/docker-outside-of-docker:1": {} }
```

**Watch the networking gotcha with docker-outside-of-docker:** containers your app spawns publish their ports on the **host's** loopback, not the devcontainer's. So a service the app starts on `127.0.0.1:8080` is reachable from the host but **not** from inside the devcontainer at that address. If your workflow needs to reach those ports from within the container, prefer docker-in-docker or publish on `0.0.0.0` and connect via `host.docker.internal`.

## Verifying it builds — and testing inside it

**Build it before you trust it.** Rebuild from a clean state so caching doesn't hide a broken step (in VS Code: "Dev Containers: Rebuild Without Cache"), or from the CLI:

```sh
npx @devcontainers/cli up --workspace-folder . --remove-existing-container
```

A feature that fails to install **aborts the whole build** (as the Node/npm example above shows), so a green build is a real signal.

**Design your test strategy around what's actually in the container.** Two common cases:

- **Tests that need no external services** should run purely inside the container — that's the point of the setup, and they should pass on a fresh build with nothing else running.
- **Tests that need a live dependency** (a database, a Docker daemon, an external API) should **probe for it and adapt**, not assume it. For a daemon, gate on a check before running the heavy path:

  ```sh
  docker info >/dev/null 2>&1 && echo "daemon available" || echo "skipping docker-dependent tests"
  ```

  Where possible, stub or mock the dependency so the core suite stays runnable everywhere (including a container that deliberately has no Docker access), and keep the live-integration checks as an opt-in layer on top.

## Using it

1. Open the repo in an editor with devcontainer support (VS Code + the **Dev Containers** extension, or a compatible tool).
2. **Reopen in Container** (Command Palette → "Dev Containers: Reopen in Container"). The first build installs features and runs `postCreateCommand`.
3. Work as normal — the terminal, extensions, and forwarded ports are all inside the container.
4. Changed `.devcontainer/devcontainer.json`? **Rebuild Container** to apply it.

## Further reading

- [containers.dev](https://containers.dev/) — the Development Containers specification
- [Available features](https://containers.dev/features)
- [`devcontainer.json` reference](https://containers.dev/implementors/json_reference/)
- [`@devcontainers/cli`](https://github.com/devcontainers/cli) — build and run devcontainers from the command line
