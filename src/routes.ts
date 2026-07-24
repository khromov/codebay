import {
	Mochi,
	apiError,
	error,
	json,
	type MochiApiEvent,
	type MochiRouteValue
} from 'mochi-framework';
import { dockerArch, dockerAvailable, pruneBuildCache } from './lib/docker.server.ts';
import { devcontainerCliAvailable } from './lib/devcontainer.server.ts';
import { resolveInjections } from './lib/injections.server.ts';
import {
	DEFAULT_HAIKU_MODEL,
	DEFAULT_MODEL,
	DEFAULT_OPUS_MODEL,
	DEFAULT_SMALL_FAST_MODEL,
	DEFAULT_SONNET_MODEL
} from './container-injections/claude-code-custom.ts';
import { parseHostEnvVarNames } from './container-injections/host-env-vars.ts';
import { browse } from './lib/picker.server.ts';
import {
	addForwardedPort,
	createInstance,
	deleteAllInstances,
	deleteDatabaseAndShutdown,
	deleteInstance,
	listInstances,
	rebuildInstance,
	rebuildRunningInstancesNoCache,
	removeForwardedPort,
	renameInstance,
	sanitizeInstance,
	startInstance,
	stopInstance,
	streamClose,
	streamOpen,
	subscribeLogs
} from './lib/instances.server.ts';
import {
	deleteFolderHistory,
	getInstance,
	getOption,
	listFolderHistory,
	setOption
} from './lib/db.server.ts';
import { DEFAULT_IMAGE } from './lib/config.server.ts';
import { wsUpgradeAllowed } from './lib/auth.server.ts';
import { clearAttention, setAttention } from './lib/bridge.server.ts';
import { timingSafeEqualStr } from './lib/crypto.server.ts';
import { proxyRoutes } from './lib/proxy.server.ts';

async function preflight() {
	const [docker, cli, auth] = await Promise.all([
		dockerAvailable(),
		devcontainerCliAvailable(),
		// Provider-agnostic: every injection that declares host-side auth surfaces a
		// chip automatically, so adding an injection extends the setup UI for free.
		Promise.all(
			resolveInjections()
				.filter((i) => i.auth)
				.map(async (i) => {
					const status = await i.auth!.status();
					return {
						id: i.id,
						label: i.label,
						available: status.available,
						source: status.source,
						hint: i.auth!.hint
					};
				})
		)
	]);
	return { docker, cli, auth };
}

/**
 * Run `fn`, JSON-serializing its result, or turning a thrown Error into a 400
 * apiError. Lets a mutating route handler just `throw new Error(...)` for both
 * input validation and business-logic failures, instead of branching between an
 * early `apiError(400, ...)` return and a wrapping try/catch.
 */
async function mutate(fn: () => Promise<unknown> | unknown): Promise<Response> {
	try {
		return json(await fn());
	} catch (err) {
		return apiError(400, (err as Error).message);
	}
}

/**
 * Wrap a single-HTTP-method mutation route: reject any other method with 405,
 * then run `handler` through `mutate`. Replaces the `if (method !== X) return
 * apiError(405, ...); try {...} catch {...}` shape every mutating route in this
 * file was repeating. The one route that needs a non-200 success status
 * (instance creation, which returns 201) is written out by hand below instead.
 */
function mutationRoute(
	method: 'POST' | 'DELETE',
	handler: (event: MochiApiEvent) => Promise<unknown> | unknown
) {
	return Mochi.api((event) => {
		if (event.method !== method) return apiError(405, 'Method Not Allowed');
		return mutate(() => handler(event));
	});
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
			snapshot: await listInstances()
		})
	}),

	'/ide/:id': Mochi.page('./src/pages/App.svelte', {
		serverProps: async (_req, params) => {
			if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
			return {
				preflight: await preflight(),
				initialPath: `/ide/${params.id}`,
				snapshot: await listInstances()
			};
		}
	}),

	'/instances/:id': Mochi.page('./src/pages/Instance.svelte', {
		serverProps: (_req, params) => {
			// Validate the instance exists, but the view hydrates its data from the stream.
			if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
			// Registry-derived count of injection-backed health checks, so the health
			// panel's skeleton renders one row per real check before the first snapshot.
			return { id: params.id, injectionChecks: resolveInjections().filter((i) => i.check).length };
		}
	}),

	'/settings': Mochi.page('./src/pages/Settings.svelte', {
		serverProps: async () => {
			// Host env vars: only names are ever sent to the client — never values.
			// `hostEnvVarPresence` tells the UI which configured names currently have a
			// value on this process's env, so it can show a per-row "set / missing" hint.
			const hostEnvVarNames = parseHostEnvVarNames(getOption('host_env_var_names'));
			return {
				defaultImage: getOption('default_image') ?? DEFAULT_IMAGE,
				builtinImage: DEFAULT_IMAGE,
				disableBuildCache: getOption('disable_build_cache') === '1',
				dockerArch: await dockerArch(),
				// Manual token overrides: send only whether each is set (never the secret
				// value itself) plus the toggle state, so the page can render placeholders.
				manualTokensEnabled: getOption('manual_tokens_enabled') === '1',
				githubTokenSet: !!getOption('manual_github_token'),
				claudeTokenSet: !!getOption('manual_claude_code_token'),
				// Custom endpoint (LiteLLM / Bedrock): toggle state, base URL (non-secret),
				// whether the token is set (never the secret value), and model IDs prefilled
				// from the module defaults when not yet customised.
				customEndpointEnabled: getOption('custom_endpoint_enabled') === '1',
				customEndpointBaseUrl: getOption('custom_endpoint_base_url') ?? '',
				customEndpointTokenSet: !!getOption('custom_endpoint_token')?.trim(),
				customEndpointOpusModel: getOption('custom_endpoint_opus_model') ?? DEFAULT_OPUS_MODEL,
				customEndpointSonnetModel:
					getOption('custom_endpoint_sonnet_model') ?? DEFAULT_SONNET_MODEL,
				customEndpointHaikuModel: getOption('custom_endpoint_haiku_model') ?? DEFAULT_HAIKU_MODEL,
				customEndpointSmallFastModel:
					getOption('custom_endpoint_small_fast_model') ?? DEFAULT_SMALL_FAST_MODEL,
				customEndpointModel: getOption('custom_endpoint_model') ?? DEFAULT_MODEL,
				hostEnvVarsEnabled: getOption('host_env_vars_enabled') === '1',
				hostEnvVarNames,
				hostEnvVarPresence: Object.fromEntries(
					hostEnvVarNames.map((name) => [name, Bun.env[name] !== undefined && Bun.env[name] !== ''])
				)
			};
		}
	}),

	// Persist the default container image used when a source folder ships no devcontainer.json.
	'/api/settings/default-image': mutationRoute('POST', async ({ request }) => {
		const body = (await request.json().catch(() => null)) as { image?: string } | null;
		const image = body?.image?.trim();
		if (!image) throw new Error('image is required');
		setOption('default_image', image);
		return { ok: true };
	}),

	// Global "disable build cache" flag: when on, every build (first boot + rebuild)
	// passes --build-no-cache. Stored in the options table like default_image.
	'/api/settings/disable-build-cache': mutationRoute('POST', async ({ request }) => {
		const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
		if (typeof body?.enabled !== 'boolean') throw new Error('enabled (boolean) is required');
		setOption('disable_build_cache', body.enabled ? '1' : '0');
		return { ok: true };
	}),

	// Manually-provided GitHub / Claude Code tokens (partial update: only the keys
	// present in the body are written). These override host credential discovery for
	// container injection when the toggle is enabled — see the two credential injections.
	// A blank token string clears that key. Stored plaintext in the options table; the
	// values are never sent back to the client (serverProps only reports "is set").
	'/api/settings/manual-tokens': mutationRoute('POST', async ({ request }) => {
		const body = (await request.json().catch(() => null)) as {
			enabled?: boolean;
			githubToken?: string;
			claudeToken?: string;
		} | null;
		if (!body) throw new Error('Invalid body');
		if ('enabled' in body) {
			if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean');
			setOption('manual_tokens_enabled', body.enabled ? '1' : '0');
		}
		if ('githubToken' in body) {
			if (typeof body.githubToken !== 'string') throw new Error('githubToken must be a string');
			setOption('manual_github_token', body.githubToken.trim());
		}
		if ('claudeToken' in body) {
			if (typeof body.claudeToken !== 'string') throw new Error('claudeToken must be a string');
			setOption('manual_claude_code_token', body.claudeToken.trim());
		}
		return { ok: true };
	}),

	// Custom LiteLLM / Bedrock endpoint settings (partial update: only the keys
	// present in the body are written). The token is stored plaintext in the options
	// table (same as the manual Claude token) and is never returned to the client.
	// A blank string clears the corresponding key.
	'/api/settings/custom-endpoint': mutationRoute('POST', async ({ request }) => {
		const body = (await request.json().catch(() => null)) as {
			enabled?: boolean;
			baseUrl?: string;
			token?: string;
			opusModel?: string;
			sonnetModel?: string;
			haikuModel?: string;
			smallFastModel?: string;
			defaultModel?: string;
		} | null;
		if (!body) throw new Error('Invalid body');
		if ('enabled' in body) {
			if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean');
			setOption('custom_endpoint_enabled', body.enabled ? '1' : '0');
		}
		if ('baseUrl' in body) {
			if (typeof body.baseUrl !== 'string') throw new Error('baseUrl must be a string');
			setOption('custom_endpoint_base_url', body.baseUrl.trim());
		}
		if ('token' in body) {
			if (typeof body.token !== 'string') throw new Error('token must be a string');
			setOption('custom_endpoint_token', body.token.trim());
		}
		if ('opusModel' in body) {
			if (typeof body.opusModel !== 'string') throw new Error('opusModel must be a string');
			setOption('custom_endpoint_opus_model', body.opusModel.trim());
		}
		if ('sonnetModel' in body) {
			if (typeof body.sonnetModel !== 'string') throw new Error('sonnetModel must be a string');
			setOption('custom_endpoint_sonnet_model', body.sonnetModel.trim());
		}
		if ('haikuModel' in body) {
			if (typeof body.haikuModel !== 'string') throw new Error('haikuModel must be a string');
			setOption('custom_endpoint_haiku_model', body.haikuModel.trim());
		}
		if ('smallFastModel' in body) {
			if (typeof body.smallFastModel !== 'string')
				throw new Error('smallFastModel must be a string');
			setOption('custom_endpoint_small_fast_model', body.smallFastModel.trim());
		}
		if ('defaultModel' in body) {
			if (typeof body.defaultModel !== 'string') throw new Error('defaultModel must be a string');
			setOption('custom_endpoint_model', body.defaultModel.trim());
		}
		return { ok: true };
	}),

	// Host env vars forwarded into containers (partial update: only the keys present
	// in the body are written). Only variable *names* are stored — values are read
	// fresh from this process's environment at apply time, never persisted, and never
	// accepted from the client. `names` replaces the full list; validated as
	// non-empty, deduped, shell-identifier-safe strings.
	'/api/settings/host-env-vars': mutationRoute('POST', async ({ request }) => {
		const body = (await request.json().catch(() => null)) as {
			enabled?: boolean;
			names?: string[];
		} | null;
		if (!body) throw new Error('Invalid body');
		if ('enabled' in body) {
			if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean');
			setOption('host_env_vars_enabled', body.enabled ? '1' : '0');
		}
		if ('names' in body) {
			if (!Array.isArray(body.names) || !body.names.every((n) => typeof n === 'string')) {
				throw new Error('names must be an array of strings');
			}
			const names = [...new Set(body.names.map((n) => n.trim()))].filter(Boolean);
			for (const name of names) {
				if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
					throw new Error(`invalid variable name: ${name}`);
				}
			}
			setOption('host_env_var_names', JSON.stringify(names));
		}
		return { ok: true };
	}),

	// Clear BuildKit's build cache so the next build runs uncached. Returns bytes freed.
	'/api/settings/clear-build-cache': mutationRoute('POST', async () => {
		return await pruneBuildCache();
	}),

	// Rebuild every currently-running instance from scratch (no build cache).
	'/api/instances/rebuild-all-no-cache': mutationRoute('POST', () => ({
		count: rebuildRunningInstancesNoCache()
	})),

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
		// Mochi.ws routes bypass the global basicAuth handle, so enforce origin + auth here.
		upgrade: (req) => (wsUpgradeAllowed(req) ? {} : false),
		open: streamOpen,
		message: () => {},
		close: streamClose
	}),

	'/api/instances': Mochi.api(async ({ method, request }) => {
		if (method === 'GET') return json({ instances: await listInstances() });
		if (method === 'POST') {
			const body = (await request.json().catch(() => null)) as {
				sourcePath?: string;
				name?: string;
				branch?: string;
			} | null;
			if (!body?.sourcePath) return apiError(400, 'sourcePath is required');
			try {
				const instance = await createInstance(body.sourcePath, body.name, { branch: body.branch });
				return json({ instance: sanitizeInstance(instance) }, { status: 201 });
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
			return mutate(async () => {
				const body = (await request.json().catch(() => null)) as { sourcePath?: string } | null;
				if (!body?.sourcePath) throw new Error('sourcePath is required');
				deleteFolderHistory(body.sourcePath);
				return { ok: true };
			});
		}
		return apiError(405, 'Method Not Allowed');
	}),

	'/api/instances/delete-all': mutationRoute('POST', async () => {
		await deleteAllInstances();
		return { ok: true };
	}),

	// Full reset: tear down every instance, delete the database, then shut the server
	// down. Behind Basic Auth (when configured) and the CSRF guard like the rest of
	// the UI/APIs — see auth.server.ts.
	'/api/shutdown': mutationRoute('POST', async () => {
		await deleteDatabaseAndShutdown();
		return { ok: true };
	}),

	'/api/instances/:id/rename': mutationRoute('POST', async ({ params, request }) => {
		const body = (await request.json().catch(() => null)) as { name?: string } | null;
		if (!body?.name) throw new Error('name is required');
		return { instance: sanitizeInstance(renameInstance(params.id!, body.name)) };
	}),

	// Forwarded ports: add (POST {port}) / remove (DELETE) a container port mapping.
	// Both only mutate the persisted set — call /rebuild to recreate the container with it.
	'/api/instances/:id/ports': mutationRoute('POST', async ({ params, request }) => {
		const body = (await request.json().catch(() => null)) as { port?: number } | null;
		if (typeof body?.port !== 'number') throw new Error('port (number) is required');
		return { instance: sanitizeInstance(await addForwardedPort(params.id!, body.port)) };
	}),

	'/api/instances/:id/ports/:port': mutationRoute('DELETE', ({ params }) => {
		const port = Number.parseInt(params.port!, 10);
		if (!Number.isInteger(port)) throw new Error('Invalid port');
		return { instance: sanitizeInstance(removeForwardedPort(params.id!, port)) };
	}),

	// Re-run `devcontainer up` to apply the current forwarded-port set (recreates the container).
	'/api/instances/:id/rebuild': mutationRoute('POST', ({ params }) => ({
		instance: sanitizeInstance(rebuildInstance(params.id!))
	})),

	'/api/instances/:id/start': mutationRoute('POST', async ({ params }) => ({
		instance: sanitizeInstance(await startInstance(params.id!))
	})),

	'/api/instances/:id/stop': mutationRoute('POST', async ({ params }) => ({
		instance: sanitizeInstance(await stopInstance(params.id!))
	})),

	'/api/instances/:id/delete': mutationRoute('POST', async ({ params }) => {
		await deleteInstance(params.id!);
		return { ok: true };
	}),

	// Dismiss an instance's attention pulse (called by the UI when its tab is focused).
	'/api/instances/:id/attention/clear': mutationRoute('POST', ({ params }) => {
		clearAttention(params.id!);
		return { ok: true };
	}),

	// Bridge: containers call back here (token-authed, exempt from Basic Auth and the
	// CSRF guard — see auth.server.ts) to raise/lower their attention pulse. id/state
	// ride in the query string (not secret); the token rides in a header instead, so
	// it doesn't end up in request logs the way a query param would.
	'/api/bridge/attention': Mochi.api(async ({ method, url, request }) => {
		if (method !== 'POST') return apiError(405, 'Method Not Allowed');
		const id = url.searchParams.get('id');
		const token = request.headers.get('X-Bridge-Token');
		const state = url.searchParams.get('state');
		console.log(
			`[bridge] attention POST id=${id ?? '(none)'} state=${state ?? '(none)'} hasToken=${!!token}`
		);
		if (!id || !token) {
			console.warn('[bridge] rejected: missing id or token');
			return apiError(400, 'id and token are required');
		}
		const row = getInstance(id);
		// Return a uniform 403 whether the instance is missing or the token is wrong,
		// and use a constant-time compare — so an attacker can't enumerate which
		// instance ids exist, nor probe the token byte-by-byte via response timing.
		if (!row || !row.bridge_token || !timingSafeEqualStr(token, row.bridge_token)) {
			console.warn(
				`[bridge] rejected id=${id}: ${!row ? 'no such instance' : !row.bridge_token ? 'instance has no bridge_token' : 'token mismatch'}`
			);
			return apiError(403, 'Forbidden');
		}
		if (state === 'done') setAttention(id, 'done');
		else if (state === 'waiting') setAttention(id, 'waiting');
		else clearAttention(id); // 'busy' / anything else → Claude resumed, dismiss the pulse
		console.log(
			`[bridge] accepted id=${id} → attention=${state === 'done' || state === 'waiting' ? state : 'cleared'}`
		);
		return json({ ok: true });
	}),

	// Live boot/build log stream for one instance (WebSocket). Replays the buffer
	// then streams new chunks as raw text — WS frames tolerate embedded newlines.
	'/api/instances/:id/logs': Mochi.ws<{ id: string; unsub?: () => void }>({
		upgrade: (req, params) =>
			wsUpgradeAllowed(req) && params.id && getInstance(params.id) ? { id: params.id } : false,
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
		}
	}),

	// Reverse proxy for each instance's code-server: /p/:id redirect, /p/:id/*
	// HTTP+WS handler, and the WebSocket relay sentinel.
	...proxyRoutes,

	// Dev-only previews: every avatar sprite, and the UI component showcase.
	...(process.env.MODE === 'development'
		? {
				'/debug': Mochi.page('./src/pages/UI.svelte', {
					// Feed the showcase the real auth providers so CredMenu mirrors `/`.
					serverProps: async () => ({ preflight: await preflight() })
				}),
				'/debug/avatars': Mochi.page('./src/pages/Avatars.svelte')
			}
		: {})
};
