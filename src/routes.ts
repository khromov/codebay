import { Mochi, apiError, error, json, type MochiRouteValue } from 'mochi-framework';
import { dockerAvailable } from './lib/docker.server.ts';
import { devcontainerCliAvailable } from './lib/devcontainer.server.ts';
import { claudeAuthStatus } from './lib/claude.server.ts';
import { ghAuthStatus } from './lib/gh.server.ts';
import { browse } from './lib/picker.server.ts';
import {
  addForwardedPort,
  createInstance,
  deleteAllInstances,
  deleteDatabaseAndShutdown,
  deleteInstance,
  listInstances,
  rebuildInstance,
  removeForwardedPort,
  renameInstance,
  startInstance,
  stopInstance,
  streamClose,
  streamOpen,
  subscribeLogs,
} from './lib/instances.server.ts';
import { deleteFolderHistory, getInstance, listFolderHistory } from './lib/db.server.ts';
import { clearAttention, setAttention } from './lib/bridge.server.ts';
import { proxyRoutes } from './lib/proxy.server.ts';

async function preflight() {
  const [docker, cli, claude, gh] = await Promise.all([
    dockerAvailable(),
    devcontainerCliAvailable(),
    claudeAuthStatus(),
    ghAuthStatus(),
  ]);
  return {
    docker,
    cli,
    // Provider-agnostic so the UI can list more authorizations later.
    auth: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        available: claude.available,
        source: claude.source,
        hint: 'run `claude` and sign in',
      },
      {
        id: 'github-cli',
        label: 'GitHub CLI',
        available: gh.available,
        source: gh.source,
        hint: 'run `gh auth login`',
      },
    ],
  };
}

export const routes: Record<string, MochiRouteValue> = {
  // Dashboard and the tabbed IDE share one persistent hydrated shell so that
  // navigating between them is an in-place client transition (no full reload) and
  // the code-server iframes stay mounted. `snapshot` seeds the live list so both
  // the grid and the IDE iframe render without a loading flash.
  '/': Mochi.page('./src/pages/App.svelte', {
    serverProps: async () => ({
      preflight: await preflight(),
      initialPath: '/',
      snapshot: await listInstances(),
    }),
  }),

  '/ide/:id': Mochi.page('./src/pages/App.svelte', {
    serverProps: async (_req, params) => {
      if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
      return {
        preflight: await preflight(),
        initialPath: `/ide/${params.id}`,
        snapshot: await listInstances(),
      };
    },
  }),

  '/instances/:id': Mochi.page('./src/pages/Instance.svelte', {
    serverProps: (_req, params) => {
      // Validate the instance exists, but the view hydrates its data from the stream.
      if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
      return { id: params.id };
    },
  }),

  '/settings': Mochi.page('./src/pages/Settings.svelte'),

  // Filesystem browser for picking a project folder.
  '/api/browse': Mochi.api(async ({ url }) => {
    try {
      return json(await browse(url.searchParams.get('path') ?? undefined));
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  // Central live stream (WebSocket): typed events for the whole UI — the full
  // reconciled instance list and continuous per-instance health. A fresh socket
  // is seeded with the current state. Clients filter by event `type`.
  '/api/stream': Mochi.ws({
    open: streamOpen,
    message: () => {},
    close: streamClose,
  }),

  '/api/instances': Mochi.api(async ({ method, request }) => {
    if (method === 'GET') return json({ instances: await listInstances() });
    if (method === 'POST') {
      const body = (await request.json().catch(() => null)) as
        | { sourcePath?: string; name?: string }
        | null;
      if (!body?.sourcePath) return apiError(400, 'sourcePath is required');
      try {
        const instance = await createInstance(body.sourcePath, body.name);
        return json({ instance }, { status: 201 });
      } catch (err) {
        return apiError(400, (err as Error).message);
      }
    }
    return apiError(405, 'Method Not Allowed');
  }),

  // Re-creation history of previously-used source folders.
  '/api/history': Mochi.api(async ({ method, request }) => {
    if (method === 'GET') return json({ history: listFolderHistory() });
    if (method === 'DELETE') {
      const body = (await request.json().catch(() => null)) as { sourcePath?: string } | null;
      if (!body?.sourcePath) return apiError(400, 'sourcePath is required');
      deleteFolderHistory(body.sourcePath);
      return json({ ok: true });
    }
    return apiError(405, 'Method Not Allowed');
  }),

  '/api/instances/delete-all': Mochi.api(async ({ method }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    await deleteAllInstances();
    return json({ ok: true });
  }),

  // Full reset: tear down every instance, delete the database, then shut the server
  // down. Behind Basic Auth like the rest of the UI/APIs.
  '/api/shutdown': Mochi.api(async ({ method }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    await deleteDatabaseAndShutdown();
    return json({ ok: true });
  }),

  '/api/instances/:id/rename': Mochi.api(async ({ method, params, request }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    if (!body?.name) return apiError(400, 'name is required');
    try {
      return json({ instance: renameInstance(params.id!, body.name) });
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  // Forwarded ports: add (POST {port}) / remove (DELETE) a container port mapping.
  // Both only mutate the persisted set — call /rebuild to recreate the container with it.
  '/api/instances/:id/ports': Mochi.api(async ({ method, params, request }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    const body = (await request.json().catch(() => null)) as { port?: number } | null;
    if (typeof body?.port !== 'number') return apiError(400, 'port (number) is required');
    try {
      return json({ instance: addForwardedPort(params.id!, body.port) });
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  '/api/instances/:id/ports/:port': Mochi.api(async ({ method, params }) => {
    if (method !== 'DELETE') return apiError(405, 'Method Not Allowed');
    const port = Number.parseInt(params.port!, 10);
    if (!Number.isInteger(port)) return apiError(400, 'Invalid port');
    try {
      return json({ instance: removeForwardedPort(params.id!, port) });
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  // Re-run `devcontainer up` to apply the current forwarded-port set (recreates the container).
  '/api/instances/:id/rebuild': Mochi.api(async ({ method, params }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    try {
      return json({ instance: rebuildInstance(params.id!) });
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  '/api/instances/:id/start': Mochi.api(async ({ method, params }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    try {
      return json({ instance: await startInstance(params.id!) });
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  '/api/instances/:id/stop': Mochi.api(async ({ method, params }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    try {
      return json({ instance: await stopInstance(params.id!) });
    } catch (err) {
      return apiError(400, (err as Error).message);
    }
  }),

  '/api/instances/:id/delete': Mochi.api(async ({ method, params }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    await deleteInstance(params.id!);
    return json({ ok: true });
  }),

  // Dismiss an instance's attention pulse (called by the UI when its tab is focused).
  '/api/instances/:id/attention/clear': Mochi.api(async ({ method, params }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    clearAttention(params.id!);
    return json({ ok: true });
  }),

  // Bridge: containers call back here (token-authed, exempt from Basic Auth — see
  // auth.server.ts) to raise/lower their attention pulse. id+token+state in the query.
  '/api/bridge/attention': Mochi.api(async ({ method, url }) => {
    if (method !== 'POST' && method !== 'GET') return apiError(405, 'Method Not Allowed');
    const id = url.searchParams.get('id');
    const token = url.searchParams.get('token');
    const state = url.searchParams.get('state');
    if (!id || !token) return apiError(400, 'id and token are required');
    const row = getInstance(id);
    if (!row) return apiError(404, 'Instance not found');
    if (!row.bridge_token || token !== row.bridge_token) return apiError(403, 'Invalid token');
    if (state === 'done') setAttention(id, 'done');
    else if (state === 'waiting') setAttention(id, 'waiting');
    else clearAttention(id); // 'busy' / anything else → Claude resumed, dismiss the pulse
    return json({ ok: true });
  }),

  // Live boot/build log stream for one instance (WebSocket). Replays the buffer
  // then streams new chunks as raw text — WS frames tolerate embedded newlines.
  '/api/instances/:id/logs': Mochi.ws<{ id: string; unsub?: () => void }>({
    upgrade: (_req, params) => (params.id ? { id: params.id } : false),
    open(ws) {
      ws.data.user.unsub = subscribeLogs(ws.data.user.id, (chunk) => {
        try {
          ws.send(chunk);
        } catch {
          /* socket closed */
        }
      });
    },
    message: () => {},
    close(ws) {
      ws.data.user.unsub?.();
    },
  }),

  // Reverse proxy for each instance's code-server: /p/:id redirect, /p/:id/*
  // HTTP+WS handler, and the WebSocket relay sentinel.
  ...proxyRoutes,

  // Dev-only previews: every avatar sprite, and the UI component showcase.
  ...(process.env.MODE === 'development'
    ? {
        '/debug': Mochi.page('./src/pages/UI.svelte', {
          // Feed the showcase the real auth providers so CredMenu mirrors `/`.
          serverProps: async () => ({ preflight: await preflight() }),
        }),
        '/debug/avatars': Mochi.page('./src/pages/Avatars.svelte'),
      }
    : {}),
};
