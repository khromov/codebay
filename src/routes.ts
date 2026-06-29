import { Mochi, apiError, error, json, type MochiRouteValue } from 'mochi-framework';
import { dockerAvailable } from './lib/docker.server.ts';
import { devcontainerCliAvailable } from './lib/devcontainer.server.ts';
import { claudeAuthStatus } from './lib/claude.server.ts';
import { ghAuthStatus } from './lib/gh.server.ts';
import { browse } from './lib/picker.server.ts';
import {
  createInstance,
  deleteAllInstances,
  deleteInstance,
  listInstances,
  renameInstance,
  startInstance,
  stopInstance,
  subscribeInstances,
  subscribeLogs,
} from './lib/instances.server.ts';
import { deleteFolderHistory, getInstance, listFolderHistory } from './lib/db.server.ts';
import { getHealth } from './lib/health.server.ts';
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

  // Live instance list over SSE — first message is the full current state.
  '/api/instances/stream': Mochi.sse((stream) => {
    const send = (list: unknown) => {
      try {
        stream.send(JSON.stringify(list));
      } catch {
        /* stream closed between broadcast and send */
      }
    };
    const unsubscribe = subscribeInstances(send);
    stream.onClose(unsubscribe);
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

  // Live health snapshot for one instance, kept fresh by a background monitor
  // (see health.server.ts). The UI polls this; results are never persisted.
  '/api/instances/:id/health': Mochi.api(async ({ method, params }) => {
    if (method !== 'GET') return apiError(405, 'Method Not Allowed');
    try {
      return json(await getHealth(params.id!));
    } catch (err) {
      return apiError(404, (err as Error).message);
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

  // Live boot/build log stream for one instance.
  '/api/instances/:id/logs': Mochi.sse((stream, req) => {
    const id = new URL(req.url).pathname.split('/')[3];
    if (!id) {
      stream.close();
      return;
    }
    // JSON-encode each chunk so embedded newlines don't break SSE framing.
    const unsubscribe = subscribeLogs(id, (chunk) => {
      try {
        stream.send(JSON.stringify(chunk));
      } catch {
        /* stream closed */
      }
    });
    stream.onClose(unsubscribe);
  }),

  // Reverse proxy for each instance's code-server: /p/:id redirect, /p/:id/*
  // HTTP+WS handler, and the WebSocket relay sentinel.
  ...proxyRoutes,

  // Dev-only previews: every avatar sprite, and the UI component showcase.
  ...(process.env.MODE === 'development'
    ? {
        '/ui': Mochi.page('./src/pages/UI.svelte', {
          // Feed the showcase the real auth providers so CredMenu mirrors `/`.
          serverProps: async () => ({ preflight: await preflight() }),
        }),
        '/ui/avatars': Mochi.page('./src/pages/Avatars.svelte'),
      }
    : {}),
};
