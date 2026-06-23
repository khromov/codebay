import { Mochi, apiError, error, json, type MochiRouteValue } from 'mochi-framework';
import { dockerAvailable } from './lib/docker.server.ts';
import { devcontainerCliAvailable } from './lib/devcontainer.server.ts';
import { claudeAuthAvailable } from './lib/claude.server.ts';
import { browse } from './lib/picker.server.ts';
import {
  createInstance,
  deleteAllInstances,
  deleteInstance,
  listInstances,
  startInstance,
  stopInstance,
  subscribeInstances,
  subscribeLogs,
} from './lib/instances.server.ts';
import { deleteFolderHistory, getInstance, listFolderHistory } from './lib/db.server.ts';

async function preflight() {
  const [docker, cli, claudeAuth] = await Promise.all([
    dockerAvailable(),
    devcontainerCliAvailable(),
    claudeAuthAvailable(),
  ]);
  return { docker, cli, claudeAuth };
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
};
