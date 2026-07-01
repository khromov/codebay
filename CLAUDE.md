# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web UI for spinning up isolated [devcontainer](https://containers.dev/) instances from any local folder, each exposing a browser-based VS Code (`code-server`). Pick a project folder → the app copies it, injects code-server into its `devcontainer.json`, runs `devcontainer up`, and publishes the editor on a unique host port.

## Runtime & commands

This runs on **Bun only** (Node.js is not supported). The app is built on **Mochi**, an SSR Svelte 5 framework with islands-based selective hydration, vendored under `vendor/mochi-framework`.

```sh
bun run dev        # dev server (MODE=development, project-local DATA_DIR, no browser launch)
bun run start      # runs src/index.ts directly (no separate build step needed)
bun run build      # mochi-framework build → .mochi/
bun run typecheck  # svelte-check (with a custom warning-ignore flag) + tsc --noEmit; run after any TS/Svelte change
bun test           # all tests
bun test src/index.isolated.test.ts          # single file
bun test -t "renders Hello world"            # single test by name
bun run clean      # remove .mochi build output
bun run gen:chimes # re-render attention chimes to public/sounds/ WAVs (after editing scripts/gen-chimes.ts)
```

Tests are named `*.isolated.test.ts`. Note that `db.server.ts` pins its SQLite handle to `globalThis`, so all tests in a run share one DB connection — don't `rmSync(DATA_DIR)` in a test's `afterAll` or you'll yank state out from under other tests.

Both `dev` and `start` execute `src/index.ts` with Bun (Mochi serves SSR pages on the fly); `build` is only needed for a precompiled production bundle. The `dev` script already sets `MODE=development`, `DISABLE_OPEN_BROWSER=1`, and `DATA_DIR=./.devcontainers-manager` (keeps state inside the repo while developing).

**Port:** the server reads `PORT` (default 3333). When _you_ (Claude Code) run the app, use `PORT=4444 DISABLE_OPEN_BROWSER=1 bun run dev` so your instance stays separate from one the user may have running on 3333.

**Browser launch:** on startup the server opens the web UI in the user's default browser. Set `DISABLE_OPEN_BROWSER=1` to skip it — _you_ (Claude Code) should always run with this set (the `dev` script already does).

**Dev-only routes:** when `MODE=development`, `/debug` (UI component showcase) and `/debug/avatars` (every avatar sprite) are mounted.

## Architecture

**Request flow.** `src/index.ts` boots `Mochi.serve` (with the global `basicAuth` handle wrapping every request — see Auth below) and the route table in `src/routes.ts`. Routes are `Mochi.page` (SSR Svelte page), `Mochi.api` (JSON handler), or `Mochi.ws` (WebSocket). Pages SSR with minimal `serverProps` (plus a `snapshot` of the current instance list to avoid a loading flash); live data is then hydrated client-side over WebSockets. The dashboard (`/`) and tabbed IDE (`/ide/:id`) both render the same persistent hydrated `App.svelte` shell so navigating between them is an in-place client transition that keeps the code-server iframes mounted.

**Server-only modules.** Files ending in `.server.ts` (everything in `src/lib/`) are stripped from the client bundle by Mochi's tree-shaker. Keep Node/Bun APIs, Docker calls, SQLite, and filesystem access in `.server.ts` files — importing them into a hydrated component would leak them (or fail) on the client.

**Instance lifecycle** (`src/lib/instances.server.ts`) — the core orchestration:

1. `createInstance` validates the source folder, allocates a host port, writes a `creating` row, and kicks off `boot()` in the background (the HTTP request returns immediately).
2. `boot()` (background): `copyWorkspace` (skips `node_modules` but **keeps `.git`** so each instance retains its history/remote) → `writeOverrideConfig` (injects the code-server feature + appPort + a `postStartCommand` launcher into the copied `devcontainer.json`) → `devcontainerUp` (streams CLI output to the log buffer, parses the final JSON result line for the container ID) → post-up injection: runs every **container injection** in order (see Container injections below) — mark `.git` as a safe directory, copy the host's **Claude Code** and **GitHub CLI** credentials into the container (so `claude`, `gh`, and git-over-HTTPS work), and install the Claude **attention hooks**.
3. Status transitions: `creating → running` / `error`; later reconciled against live Docker state.

**Live streams over WebSocket** (`instances.server.ts`, `bridge.server.ts`, `health.server.ts`):

- _Central stream_ (`/api/stream`, `Mochi.ws`): one socket carries typed events for the whole UI — the full reconciled instance list **and** per-container health snapshots. A global `hub` broadcasts the list to all subscribers; it ticks every few seconds to catch external Docker state changes and pushes immediately on any mutation via `triggerReconcile()`. `listInstances()` reconciles persisted status against `docker inspect` and folds in in-memory attention + health state. A fresh socket is seeded with current state.
- _Per-instance logs_ (`/api/instances/:id/logs`, `Mochi.ws`): an in-memory `registry` keeps a capped log buffer (2000 lines) per instance; subscribing replays the buffer then streams new chunks.

The hub, log registry, attention map, health monitors, and DB handle are all pinned to `globalThis` (`__dcmHub`, `__dcmRegistry`, `__dcmAttention`, `__dcmHealth`, `__dcmDb`) so dev-mode hot reload doesn't reopen connections, orphan timers, or lose state.

**Reverse proxy** (`src/lib/proxy.server.ts`, spread into the route table as `proxyRoutes`): each running instance's code-server is served **same-origin** under `/p/:id/` instead of via its raw host port. `/p/:id/*` forwards HTTP to the instance's loopback `host_port`, and a WebSocket relay (dispatched through an internal `/__dcm_proxy_ws` sentinel pattern) tunnels code-server's sockets. Use `proxyPathFor(id)` to build IDE URLs.

**Bridge / attention** (`src/lib/bridge.server.ts`): an in-memory, UI-only signal each container can raise — `done` (Claude finished) or `waiting` (Claude needs input) — to pulse its IDE tab. The injected Claude hooks `curl` `host.docker.internal:$PORT/api/bridge/attention` with the instance id, a per-instance `bridge_token`, and a state. The `/api/bridge/attention` route is **exempt from Basic Auth** and authenticates by token instead; `bridge_token` is a container-only secret and is stripped from instance rows before they reach the client.

**Container injections** (`src/container-injections/`): each post-up thing the manager installs into a container is a self-contained `Injection` module (`claude-code-credentials.ts`, `github-credentials.ts`, `attention-hooks.ts`, `git-safe-directory.ts`) exporting `apply()` (install + log), an optional `auth.status()` (host-credential availability), and an optional `check()` (live presence probe). The `Injection` contract and the registry (`injections[]`) live in `src/lib/injections.server.ts` — the single source of truth: `instances.server.ts` runs every `apply()` at boot, `health.server.ts` runs every `check()`, and `routes.ts` builds the setup-UI auth chips from every `auth`. Add or remove an injection by adding its module to `src/container-injections/` (which holds only the injection modules + their test) and editing the registry list. All container command execution goes through the shared `execInContainer` helper (`src/lib/exec.server.ts`), which runs `bash -lc <script>` via dockerode's exec API. Scripts still read secrets with `$(cat)`; the helper smuggles the secret in via the exec environment (never argv) and `printf`s it into the script's stdin, then `unset`s it — so callers are unchanged and secrets never hit the process arg list.

_To add one:_ create `src/container-injections/<name>.ts` exporting an `Injection` (`id`, `label`, required `apply(target, log)`, optional `auth` for a host dependency, optional `check()` for the health list), then add it to the `injections[]` array in `src/lib/injections.server.ts`. Array order is apply order — keep `git-safe-directory` first since later git-touching steps depend on it. That single edit wires it into boot, health probing, and the setup-UI auth chips at once; no other file needs touching.

**Health** (`src/lib/health.server.ts`): when reconcile sees a container running it starts a per-container monitor that re-probes every few seconds (is code-server answering on its host port, plus each injection's `check()`) and keeps the latest snapshot in memory; the snapshot rides the central stream. The per-injection presence rows are driven by the injection registry, so they track whatever injections exist. Live-only, never persisted; stops when the container is gone.

**Auth** (`src/lib/auth.server.ts`): a global HTTP Basic Auth gate (`basicAuth` handle) protects the UI, the APIs, **and** every proxied code-server (including WS upgrades) with one password. Disabled when `BASIC_AUTH_PASSWORD` is unset/empty (local dev). The `/api/bridge/` paths are skipped because containers can't carry the app password.

**Persistence** (`src/lib/db.server.ts`): `bun:sqlite`, WAL mode, single `instances` table. State lives under `DATA_DIR` (`src/lib/config.server.ts`) — default `~/.devcontainers-manager` (outside the repo), overridable via the `DATA_DIR` env var (relative values resolve against cwd; `dev` sets it to `./.devcontainers-manager`). The DB is `<DATA_DIR>/app.sqlite`; per-instance workspace copies live under `<DATA_DIR>/instances/<id>/`. Schema changes use the inline `PRAGMA table_info` + `ALTER TABLE` migration pattern at the bottom of `open()`.

**Docker & devcontainer CLI** (`docker.server.ts`, `docker-client.server.ts`, `devcontainer.server.ts`): Docker Engine operations go through **`dockerode`** (the Docker HTTP API), via the shared client in `docker-client.server.ts`. dockerode honors `DOCKER_HOST` but not `docker context`, so the client resolves the daemon once at startup — `DOCKER_HOST` if set, else a single `docker context inspect` shell-out to read the active context's socket (Desktop, Colima, OrbStack, remote), else the default `/var/run/docker.sock` — and pins the instance to `globalThis` (`__dcmDocker`). That `docker context inspect` is the only remaining `docker` CLI spawn and exists purely for connection discovery. **Container creation still uses the `@devcontainers/cli` binary** (`devcontainer up`, resolved from local `node_modules/.bin`) — dockerode can't replace it. Host ports are allocated from the 8001–8999 range; code-server always listens on 8080 inside the container.

> Bun caveat: dockerode's `exec` _stdin streaming_ is unusable on Bun (the hijack path needs an HTTP `upgrade` event Bun doesn't emit; the non-hijack path can't half-close the request body). `execInContainer` works around this by passing the secret in the exec's environment and `printf`-piping it into the script's stdin — see below.

`writeOverrideConfig` parses the existing `devcontainer.json` as JSONC (custom `stripJsonc` strips comments/trailing commas) and merges in the code-server feature non-destructively — it operates on the _copy_, so rewriting/normalizing the file is safe.

## Vendored Mochi framework

`vendor/` is **gitignored** — the framework is vendored from `github.com/khromov/mochi` (the `packages/mochi` subdir) because Bun can't install a git subdirectory. Update it with `bun run update:mochi` (optionally pass a ref). Do not hand-edit files under `vendor/mochi-framework`; changes there are wiped on the next update.

Two MCP servers are configured (`.mcp.json`) for reference: `mochi` (framework docs) and `bun-docs`. Consult them when working with Mochi APIs (`Mochi.page/api/ws`, hydration directives like `mochi:hydrate`) or Bun-specific APIs.
