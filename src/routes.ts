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
  '/': Mochi.page('./src/pages/Dashboard.svelte', {
    // Instance data comes from the SSE stream; only the static capability check is SSR'd.
    serverProps: async () => ({ preflight: await preflight() }),
  }),

  '/instances/:id': Mochi.page('./src/pages/Instance.svelte', {
    serverProps: (_req, params) => {
      // Validate the instance exists, but the view hydrates its data from the stream.
      if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
      return { id: params.id };
    },
  }),

  // Tabbed IDE shell: one iframe per running instance, kept mounted so editor
  // state survives tab switches. `running` is a snapshot at page load.
  '/ide/:id': Mochi.page('./src/pages/IDE.svelte', {
    serverProps: async (_req, params) => {
      if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
      const running = (await listInstances()).filter((i) => i.status === 'running');
      return { activeId: params.id, running };
    },
  }),

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

  '/api/instances/:id/delete': Mochi.api(async ({ method, params }) => {
    if (method !== 'POST') return apiError(405, 'Method Not Allowed');
    await deleteInstance(params.id!);
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

  // Dev-only gallery of every avatar sprite, for eyeballing the catalog.
  ...(process.env.MODE === 'development'
    ? { '/avatars': Mochi.page('./src/pages/Avatars.svelte') }
    : {}),
};
