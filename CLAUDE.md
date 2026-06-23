# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web UI for spinning up isolated [devcontainer](https://containers.dev/) instances from any local folder, each exposing a browser-based VS Code (`code-server`). Pick a project folder → the app copies it, injects code-server into its `devcontainer.json`, runs `devcontainer up`, and publishes the editor on a unique host port.

## Runtime & commands

This runs on **Bun only** (Node.js is not supported). The app is built on **Mochi**, an SSR Svelte 5 framework with islands-based selective hydration, vendored under `vendor/mochi-framework`.

```sh
bun run dev        # dev server with hot reload (MODE=development)
bun run start      # production server (expects a prior build)
bun run build      # mochi-framework build → .mochi/
bun run typecheck  # svelte-check + tsc --noEmit; run after any TS/Svelte change
bun test           # all tests
bun test src/index.isolated.test.ts          # single file
bun test -t "renders Hello world"            # single test by name
bun run clean      # remove .mochi build output
```

**Port:** the server reads `PORT` (default 3333). When *you* (Claude Code) run the app, use `PORT=4444 DISABLE_OPEN_BROWSER=1 bun run dev` so your instance stays separate from one the user may have running on 3333.

**Browser launch:** on startup the server opens the web UI in the user's default browser. Set `DISABLE_OPEN_BROWSER=1` to skip it — *you* (Claude Code) should always run with this set.

## Architecture

**Request flow.** `src/index.ts` boots `Mochi.serve` with the route table in `src/routes.ts`. Routes are either `Mochi.page` (SSR Svelte page), `Mochi.api` (JSON handler), or `Mochi.sse` (server-sent events). Pages are server-rendered with minimal `serverProps`; the actual instance data is hydrated client-side from SSE streams, not from SSR props.

**Server-only modules.** Files ending in `.server.ts` (everything in `src/lib/`) are stripped from the client bundle by Mochi's tree-shaker. Keep Node/Bun APIs, Docker calls, SQLite, and filesystem access in `.server.ts` files — importing them into a hydrated component would leak them (or fail) on the client.

**Instance lifecycle** (`src/lib/instances.server.ts`) — the core orchestration:
1. `createInstance` validates the source folder, allocates a host port, writes a `creating` row, and kicks off `boot()` in the background (the HTTP request returns immediately).
2. `boot()`: `copyWorkspace` (skips `node_modules`/`.git`) → `writeOverrideConfig` (injects the code-server feature + appPort + a `postStartCommand` launcher into the copied `devcontainer.json`) → `devcontainerUp` (streams CLI output to the log buffer, parses the final JSON result line for the container ID).
3. Status transitions: `creating → running` / `error`; later reconciled against live Docker state.

**Two SSE streams, two patterns** (both in `instances.server.ts`):
- *Instance list* (`/api/instances/stream`): a single global `hub` broadcasts the full reconciled list to all subscribers. It ticks every 3s to catch external Docker state changes and pushes immediately on any mutation via `triggerReconcile()`. `listInstances()` reconciles persisted status against `docker inspect`.
- *Per-instance logs* (`/api/instances/:id/logs`): an in-memory `registry` keeps a capped log buffer (2000 lines) per instance; subscribing replays the buffer then streams new chunks.

Both the hub and the log registry are pinned to `globalThis` (`__dcmHub`, `__dcmRegistry`, `__dcmDb`) so dev-mode hot reload doesn't reopen connections or lose state.

**Persistence** (`src/lib/db.server.ts`): `bun:sqlite`, WAL mode, single `instances` table. The DB lives **outside the repo** at `~/.devcontainers-manager/app.sqlite` (see `config.server.ts`); per-instance workspace copies live under `~/.devcontainers-manager/instances/<id>/`. Schema changes use the inline `PRAGMA table_info` + `ALTER TABLE` migration pattern at the bottom of `open()`.

**Docker & devcontainer CLI** (`docker.server.ts`, `devcontainer.server.ts`): all Docker operations shell out to the `docker` CLI (via `Bun.spawn`) so they honor the user's active Docker context (Desktop, Colima, OrbStack, remote) rather than guessing a socket. The `@devcontainers/cli` binary is resolved from local `node_modules/.bin`. Host ports are allocated from the 8001–8999 range; code-server always listens on 8080 inside the container.

`writeOverrideConfig` parses the existing `devcontainer.json` as JSONC (custom `stripJsonc` strips comments/trailing commas) and merges in the code-server feature non-destructively — it operates on the *copy*, so rewriting/normalizing the file is safe.

## Vendored Mochi framework

`vendor/` is **gitignored** — the framework is vendored from `github.com/khromov/mochi` (the `packages/mochi` subdir) because Bun can't install a git subdirectory. Update it with `bun run update:mochi` (optionally pass a ref). Do not hand-edit files under `vendor/mochi-framework`; changes there are wiped on the next update.

Two MCP servers are configured (`.mcp.json`) for reference: `mochi` (framework docs) and `bun-docs`. Consult them when working with Mochi APIs (`Mochi.page/api/sse`, hydration directives like `mochi:hydrate`) or Bun-specific APIs.
