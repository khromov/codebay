import {
	Mochi,
	apiError,
	error,
	fail,
	json,
	success,
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
import { hostEnvVarPresence, parseHostEnvVarNames } from './container-injections/host-env-vars.ts';
import { parseCustomEnvVars } from './container-injections/custom-env-vars.ts';
import { gitIdentityEnabled } from './container-injections/git-identity.ts';
import {
	LATEST_CHECKED_AT_KEY,
	LATEST_VERSION_KEY
} from './container-injections/claude-code-update.ts';
import { getClaudePermissionMode } from './container-injections/claude-permission-mode.ts';
import { getClaudeEffortLevel } from './container-injections/claude-effort-level.ts';
import { getClaudeOutputStyle } from './container-injections/claude-output-style.ts';
import { browse } from './lib/picker.server.ts';
import { pickNamePrompt } from './avatars/name-prompts.ts';
import { avatars, findAvatar } from './avatars/index.ts';
import {
	addForwardedPort,
	broadcastDefaultMode,
	broadcastFilter,
	broadcastPet,
	broadcastTheme,
	createInstance,
	getDefaultMode,
	deleteAllInstances,
	deleteDatabaseAndShutdown,
	deleteInstance,
	listInstances,
	rebuildInstance,
	rebuildRunningInstancesNoCache,
	removeForwardedPort,
	renameInstance,
	sanitizeInstance,
	setTerminalSplit,
	startInstance,
	stopInstance,
	streamClose,
	streamOpen,
	subscribeLogs,
	invalidateSecretValues
} from './lib/instances.server.ts';
import {
	deleteFolderHistory,
	getInstance,
	getOption,
	listRuns,
	type AgentRunRow,
	listFolderHistory,
	setOption
} from './lib/db.server.ts';
import {
	APP_VERSION,
	DEFAULT_COPY_IGNORE,
	DEFAULT_IMAGE,
	PUBLIC_ORIGIN
} from './lib/config.server.ts';
import { wsUpgradeAllowed } from './lib/auth.server.ts';
import {
	MCP_PATH,
	getMcpToken,
	mcpEnabled,
	regenerateMcpToken,
	setMcpEnabled
} from './lib/mcp-auth.server.ts';
import { clearAttention, setAttention } from './lib/bridge.server.ts';
import { timingSafeEqualStr } from './lib/crypto.server.ts';
import { proxyRoutes } from './lib/proxy.server.ts';
import { requestedModel, runTimeline } from './lib/agent-runs.server.ts';
import { PR_ATTRIBUTION_KEY, prAttributionEnabled } from './lib/sandbox-ops.server.ts';
import { mcpRoutes } from './mcp/routes.server.ts';
import {
	isInstanceFilter,
	isTheme,
	normalizeMode,
	normalizePermissionMode,
	normalizeEffortLevel,
	normalizeOutputStyle,
	type InstanceFilter
} from './types.ts';

async function preflight() {
	const [docker, cli, auth] = await Promise.all([
		dockerAvailable(),
		devcontainerCliAvailable(),
		// Driven off the registry, so adding an injection extends the setup UI for free.
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
	return { docker, cli, auth, defaultMode: getDefaultMode() };
}

/** The header pet logo, resolved from the DB option. A name that left the catalog reads as "off". */
function currentPet() {
	return findAvatar(getOption('pet') ?? undefined);
}

/** The dashboard run-state filter, resolved from the DB option; an unset/invalid value reads as "all". */
function currentFilter(): InstanceFilter {
	const v = getOption('instance_filter');
	return isInstanceFilter(v) ? v : 'all';
}

/** A ceiling on how many run timelines one Agent log request can pull off disk. */
const MAX_OPEN_TIMELINES = 10;

/** The prompt and result are the two fields the Agent log panel actually renders in full. */
function agentRunPayload(run: AgentRunRow) {
	return {
		id: run.id,
		status: run.status,
		prompt: run.prompt,
		model: run.model,
		requested_model: requestedModel(run),
		result: run.result,
		error: run.error,
		is_error: run.is_error === 1,
		last_activity: run.last_activity,
		num_turns: run.num_turns,
		cost_usd: run.cost_usd,
		duration_ms: run.duration_ms,
		created_at: run.created_at,
		started_at: run.started_at,
		finished_at: run.finished_at
	};
}

/** Lets a route handler just `throw` for both validation and business-logic failures. */
async function mutate(fn: () => Promise<unknown> | unknown): Promise<Response> {
	try {
		return json(await fn());
	} catch (err) {
		return apiError(400, (err as Error).message);
	}
}

/** Always answers 200 on success, so the one route needing a 201 is written out by hand. */
function mutationRoute(
	method: 'POST' | 'DELETE',
	handler: (event: MochiApiEvent) => Promise<unknown> | unknown
) {
	return Mochi.api((event) => {
		if (event.method !== method) return apiError(405, 'Method Not Allowed');
		return mutate(() => handler(event));
	});
}

function str(formData: FormData, key: string): string {
	return String(formData.get(key) ?? '').trim();
}

/** An unchecked box is omitted from the form entirely, so presence is the only signal. */
function onChecked(formData: FormData, key: string): boolean {
	return formData.get(key) === 'on';
}

export const routes: Record<string, MochiRouteValue> = {
	// Dashboard and IDE share one shell so navigating between them keeps the iframes mounted;
	// `snapshot` seeds the live list so neither renders a loading flash first.
	'/': Mochi.page('./src/pages/App.svelte', {
		serverProps: async () => ({
			preflight: await preflight(),
			initialPath: '/',
			snapshot: await listInstances(),
			pet: currentPet(),
			filter: currentFilter()
		})
	}),

	'/ide/:id': Mochi.page('./src/pages/App.svelte', {
		serverProps: async (_req, params) => {
			if (!params.id || !getInstance(params.id)) error(404, 'Instance not found');
			return {
				preflight: await preflight(),
				initialPath: `/ide/${params.id}`,
				snapshot: await listInstances(),
				pet: currentPet(),
				filter: currentFilter()
			};
		}
	}),

	'/instances/:id': Mochi.page('./src/pages/Instance.svelte', {
		serverProps: (_req, params) => {
			// Only validates existence — the view hydrates its data from the stream.
			const row = params.id ? getInstance(params.id) : null;
			if (!row) error(404, 'Instance not found');
			// Lets the health panel's skeleton render one row per real check before the first snapshot.
			return {
				id: params.id,
				injectionChecks: resolveInjections(row.mode).filter((i) => i.check).length
			};
		},
		actions: {
			restart: ({ params }) => {
				try {
					rebuildInstance(params.id!);
				} catch (err) {
					return fail(400, { error: (err as Error).message });
				}
				return success({});
			}
		}
	}),

	// Reached from the settings page's coin. The name hint is rolled here rather than in
	// the editor so hydration can't re-roll it and swap the word out mid-load.
	'/avatars': Mochi.page('./src/pages/Avatars.svelte', {
		serverProps: () => ({ namePlaceholder: pickNamePrompt() })
	}),

	// Settings mutations are Form actions rather than JSON routes, so each control
	// still works without JS and `enhance` only upgrades it.
	'/settings': Mochi.page('./src/pages/Settings.svelte', {
		serverProps: async () => {
			// Only names ever reach the client; presence is sent separately, values never.
			const hostEnvVarNames = parseHostEnvVarNames(getOption('host_env_var_names'));
			return {
				pet: currentPet(),
				defaultMode: getDefaultMode(),
				claudePermissionMode: getClaudePermissionMode(),
				claudeEffortLevel: getClaudeEffortLevel(),
				claudeOutputStyle: getClaudeOutputStyle(),
				defaultImage: getOption('default_image') ?? DEFAULT_IMAGE,
				builtinImage: DEFAULT_IMAGE,
				disableBuildCache: getOption('disable_build_cache') === '1',
				// An explicit empty string (as opposed to unset) means "copy everything".
				copyIgnorePatterns: getOption('copy_ignore_patterns') ?? DEFAULT_COPY_IGNORE,
				builtinCopyIgnore: DEFAULT_COPY_IGNORE,
				// Blank means "use ~/.claude"; the host dir credentials/skills/statusLine read from.
				claudeConfigDir: getOption('claude_config_dir') ?? '',
				// Not secrets, so the actual values (not just a "set" flag) go to the client.
				// Blank means "no override" — fall back to the host's git config.
				mcpEnabled: mcpEnabled(),
				// The one secret here that IS sent to the client: copying it into an MCP client is
				// the whole point of it existing.
				mcpToken: mcpEnabled() ? getMcpToken() : '',
				mcpUrl: `${PUBLIC_ORIGIN}${MCP_PATH}`,
				mcpPrAttribution: prAttributionEnabled(),
				gitIdentityEnabled: gitIdentityEnabled(),
				gitIdentityName: getOption('git_identity_name') ?? '',
				gitIdentityEmail: getOption('git_identity_email') ?? '',
				dockerArch: await dockerArch(),
				// Only whether each token is set — the page renders a placeholder from that.
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
				// Manual model override (standard subscription path): toggle + five blank-by-default
				// model IDs — only the ones the user fills get injected, so no Bedrock-default seeding.
				manualModelOverrideEnabled: getOption('manual_model_override_enabled') === '1',
				manualOpusModel: getOption('manual_opus_model') ?? '',
				manualSonnetModel: getOption('manual_sonnet_model') ?? '',
				manualHaikuModel: getOption('manual_haiku_model') ?? '',
				manualSmallFastModel: getOption('manual_small_fast_model') ?? '',
				manualModel: getOption('manual_model') ?? '',
				hostEnvVarsEnabled: getOption('host_env_vars_enabled') === '1',
				hostEnvVarNames,
				hostEnvVarPresence: hostEnvVarPresence(hostEnvVarNames),
				// Freeform secrets: only the names round-trip; the values never leave the server.
				customEnvVarsEnabled: getOption('custom_env_vars_enabled') === '1',
				customEnvVarNames: parseCustomEnvVars(getOption('custom_env_vars')).map((v) => v.name),
				advancedSerialInjections: getOption('advanced_serial_injections') === '1',
				advancedNoBuildkit: getOption('advanced_no_buildkit') === '1',
				advancedBlockingExtInstall: getOption('advanced_blocking_ext_install') === '1',
				version: APP_VERSION
			};
		},
		actions: {
			// The default editor surface (full IDE vs terminal) new instances start in.
			defaultMode: ({ formData }) => {
				const mode = normalizeMode(str(formData, 'mode'));
				setOption('default_mode', mode);
				broadcastDefaultMode(mode);
				return success({ mode });
			},

			// Baked into the container launcher at provision time, so it lands on create/rebuild.
			claudePermissionMode: ({ formData }) => {
				const mode = normalizePermissionMode(str(formData, 'mode'));
				setOption('claude_permission_mode', mode);
				return success({ mode });
			},

			// Injected into ~/.claude/settings.json at provision time, so it lands on create/rebuild.
			claudeEffortLevel: ({ formData }) => {
				const level = normalizeEffortLevel(str(formData, 'level'));
				setOption('claude_effort_level', level);
				return success({ level });
			},

			// Injected into ~/.claude/settings.json at provision time, so it lands on create/rebuild.
			claudeOutputStyle: ({ formData }) => {
				const style = normalizeOutputStyle(str(formData, 'style'));
				setOption('claude_output_style', style);
				return success({ style });
			},

			// Persist the default container image used when a source folder ships no devcontainer.json.
			defaultImage: ({ formData }) => {
				const image = str(formData, 'image');
				if (!image) return fail(400, { error: 'image is required' });
				setOption('default_image', image);
				return success({ image });
			},

			disableBuildCache: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('disable_build_cache', enabled ? '1' : '0');
				return success({ enabled });
			},

			// Turning the pet on with none chosen lands on a random sprite, so there's always one to adjust.
			petToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				if (!enabled) {
					setOption('pet', '');
					broadcastPet(null);
					return success({ enabled: false });
				}
				const current = getOption('pet');
				const name =
					current && findAvatar(current)
						? current
						: avatars[Math.floor(Math.random() * avatars.length)]!.name;
				setOption('pet', name);
				broadcastPet(name);
				return success({ enabled: true, name });
			},

			petChoose: ({ formData }) => {
				const name = str(formData, 'name');
				if (!findAvatar(name)) return fail(400, { error: 'Unknown pet' });
				setOption('pet', name);
				broadcastPet(name);
				return success({ name });
			},

			// Unlike defaultImage, an empty value is valid — it means "copy everything".
			copyIgnorePatterns: ({ formData }) => {
				const patterns = str(formData, 'patterns');
				setOption('copy_ignore_patterns', patterns);
				return success({ patterns });
			},

			// The host directory Claude config injections read from; blank falls back to ~/.claude.
			claudeConfigDir: ({ formData }) => {
				const dir = str(formData, 'dir').trim();
				setOption('claude_config_dir', dir);
				return success({ dir });
			},

			mcpToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setMcpEnabled(enabled);
				return success({ enabled, token: enabled ? getMcpToken() : '' });
			},
			// Rotating breaks every client already configured with the old token, so the UI confirms.
			mcpRegenerateToken: () => success({ token: regenerateMcpToken() }),

			mcpPrAttributionToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption(PR_ATTRIBUTION_KEY, enabled ? '1' : '0');
				return success({ enabled });
			},

			gitIdentityToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('git_identity_enabled', enabled ? '1' : '0');
				return success({ enabled });
			},
			// Both fields are required — the toggle governs whether the override applies, so a
			// half-filled or empty identity is never a valid saved state.
			gitIdentityOverride: ({ formData }) => {
				const name = str(formData, 'name');
				const email = str(formData, 'email');
				if (!name || !email) {
					return fail(400, { error: 'Both name and email are required.' });
				}
				setOption('git_identity_name', name);
				setOption('git_identity_email', email);
				return success({ name, email });
			},

			// Tokens are stored plaintext in the options table and never sent back to the client.
			manualTokensToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('manual_tokens_enabled', enabled ? '1' : '0');
				return success({ enabled });
			},
			githubToken: ({ formData }) => {
				const value = str(formData, 'githubToken');
				setOption('manual_github_token', value);
				return success({ set: value.length > 0 });
			},
			claudeToken: ({ formData }) => {
				const value = str(formData, 'claudeToken');
				setOption('manual_claude_code_token', value);
				return success({ set: value.length > 0 });
			},

			customEndpointToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('custom_endpoint_enabled', enabled ? '1' : '0');
				// LiteLLM and the manual model override own the same env vars — never both.
				if (enabled) setOption('manual_model_override_enabled', '0');
				return success({ enabled });
			},
			customBaseUrl: ({ formData }) => {
				const value = str(formData, 'baseUrl');
				setOption('custom_endpoint_base_url', value);
				return success({ set: value.length > 0 });
			},
			customToken: ({ formData }) => {
				const value = str(formData, 'token');
				setOption('custom_endpoint_token', value);
				return success({ set: value.length > 0 });
			},
			customModels: ({ formData }) => {
				setOption('custom_endpoint_opus_model', str(formData, 'opusModel'));
				setOption('custom_endpoint_sonnet_model', str(formData, 'sonnetModel'));
				setOption('custom_endpoint_haiku_model', str(formData, 'haikuModel'));
				setOption('custom_endpoint_small_fast_model', str(formData, 'smallFastModel'));
				setOption('custom_endpoint_model', str(formData, 'defaultModel'));
				return success({});
			},

			manualModelToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('manual_model_override_enabled', enabled ? '1' : '0');
				// Reciprocal of customEndpointToggle — the two can't both drive model env vars.
				if (enabled) setOption('custom_endpoint_enabled', '0');
				return success({ enabled });
			},
			manualModels: ({ formData }) => {
				setOption('manual_opus_model', str(formData, 'opusModel'));
				setOption('manual_sonnet_model', str(formData, 'sonnetModel'));
				setOption('manual_haiku_model', str(formData, 'haikuModel'));
				setOption('manual_small_fast_model', str(formData, 'smallFastModel'));
				setOption('manual_model', str(formData, 'defaultModel'));
				return success({});
			},

			// Only names are stored; a value is never persisted nor accepted from the client.
			hostEnvVarsToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('host_env_vars_enabled', enabled ? '1' : '0');
				const names = parseHostEnvVarNames(getOption('host_env_var_names'));
				return success({ enabled, presence: hostEnvVarPresence(names) });
			},
			// Replaces the whole list, so both the add and remove forms post every name they want kept.
			hostEnvVarNames: ({ formData }) => {
				const raw = formData.getAll('names').map(String);
				const names = [...new Set(raw.map((n) => n.trim()))].filter(Boolean);
				for (const name of names) {
					if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
						return fail(400, { error: `invalid variable name: ${name}` });
					}
				}
				setOption('host_env_var_names', JSON.stringify(names));
				const saved = parseHostEnvVarNames(getOption('host_env_var_names'));
				return success({ presence: hostEnvVarPresence(saved) });
			},

			// Freeform name=value secrets injected into every container via containerEnv. Values are
			// stored plaintext in the options table (like the tokens above) and never sent to the client.
			customEnvVarsToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('custom_env_vars_enabled', enabled ? '1' : '0');
				// The redaction set only masks while enabled, so it must be rebuilt on either flip.
				invalidateSecretValues();
				return success({ enabled });
			},
			// Upsert one var: the client only ever sends the single var it's changing, since it never
			// holds the other secrets to resubmit (unlike host-env's whole-list-replace).
			setCustomEnvVar: ({ formData }) => {
				const name = str(formData, 'name');
				const value = str(formData, 'value');
				if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
					return fail(400, { error: `invalid variable name: ${name || '(empty)'}` });
				}
				if (!value) return fail(400, { error: 'value is required' });
				const vars = parseCustomEnvVars(getOption('custom_env_vars')).filter(
					(v) => v.name !== name
				);
				vars.push({ name, value });
				setOption('custom_env_vars', JSON.stringify(vars));
				invalidateSecretValues();
				return success({ names: vars.map((v) => v.name) });
			},
			removeCustomEnvVar: ({ formData }) => {
				const name = str(formData, 'name');
				const vars = parseCustomEnvVars(getOption('custom_env_vars')).filter(
					(v) => v.name !== name
				);
				setOption('custom_env_vars', JSON.stringify(vars));
				invalidateSecretValues();
				return success({ names: vars.map((v) => v.name) });
			},

			clearBuildCache: async () => {
				const { spaceReclaimed } = await pruneBuildCache();
				return success({ spaceReclaimed: spaceReclaimed ?? 0 });
			},

			serialInjectionsToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('advanced_serial_injections', enabled ? '1' : '0');
				return success({ enabled });
			},

			noBuildkitToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('advanced_no_buildkit', enabled ? '1' : '0');
				return success({ enabled });
			},

			blockingExtInstallToggle: ({ formData }) => {
				const enabled = onChecked(formData, 'enabled');
				setOption('advanced_blocking_ext_install', enabled ? '1' : '0');
				return success({ enabled });
			},

			clearVersionCache: () => {
				setOption(LATEST_VERSION_KEY, '');
				setOption(LATEST_CHECKED_AT_KEY, '');
				return success({});
			},

			rebuildAllNoCache: () => success({ count: rebuildRunningInstancesNoCache() }),

			// The process exits mid-flight, so the client may see success or a dropped
			// connection; SettingsView treats both as "shutting down".
			shutdown: async () => {
				await deleteDatabaseAndShutdown();
				return success({});
			}
		}
	}),

	'/api/browse': Mochi.api(async ({ url }) => {
		try {
			return json(await browse(url.searchParams.get('path') ?? undefined));
		} catch (err) {
			return apiError(400, (err as Error).message);
		}
	}),

	// Persists the dashboard filter and pushes it to every open tab over the central stream.
	'/api/settings/filter': Mochi.api(async ({ method, request }) => {
		if (method !== 'POST') return apiError(405, 'Method Not Allowed');
		const body = (await request.json().catch(() => null)) as { value?: string } | null;
		if (!body || !isInstanceFilter(body.value)) return apiError(400, 'Invalid filter');
		setOption('instance_filter', body.value);
		broadcastFilter(body.value);
		return json({ value: body.value });
	}),

	// The cookie the picker just wrote is already shared browser-wide; this only tells
	// the tabs behind the settings popup to repaint without a reload.
	'/api/settings/theme': Mochi.api(async ({ method, request }) => {
		if (method !== 'POST') return apiError(405, 'Method Not Allowed');
		const body = (await request.json().catch(() => null)) as { value?: string } | null;
		if (!body || !isTheme(body.value)) return apiError(400, 'Invalid theme');
		broadcastTheme(body.value);
		return json({ value: body.value });
	}),

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
				mode?: string;
			} | null;
			if (!body?.sourcePath) return apiError(400, 'sourcePath is required');
			try {
				// An omitted mode falls back to the global default inside createInstance.
				const mode = body.mode === undefined ? undefined : normalizeMode(body.mode);
				const instance = await createInstance(body.sourcePath, body.name, {
					branch: body.branch,
					mode
				});
				return json({ instance: sanitizeInstance(instance) }, { status: 201 });
			} catch (err) {
				return apiError(400, (err as Error).message);
			}
		}
		return apiError(405, 'Method Not Allowed');
	}),

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

	'/api/instances/:id/rename': mutationRoute('POST', async ({ params, request }) => {
		const body = (await request.json().catch(() => null)) as { name?: string } | null;
		if (!body?.name) throw new Error('name is required');
		return { instance: sanitizeInstance(renameInstance(params.id!, body.name)) };
	}),

	// Terminal mode's split-view toggle; purely a remembered UI preference.
	'/api/instances/:id/split': mutationRoute('POST', async ({ params, request }) => {
		const body = (await request.json().catch(() => null)) as { open?: boolean } | null;
		if (typeof body?.open !== 'boolean') throw new Error('open (boolean) is required');
		return { instance: sanitizeInstance(setTerminalSplit(params.id!, body.open)) };
	}),

	// Both port routes only mutate the persisted set; /rebuild is what applies it.
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

	// GET-only, so the CSRF header guard doesn't apply; the Basic Auth gate still does.
	'/api/instances/:id/agent-log': Mochi.api(({ method, params, url }) => {
		if (method !== 'GET') return apiError(405, 'Method Not Allowed');
		if (!getInstance(params.id!)) return apiError(404, 'Instance not found');
		const runs = listRuns(params.id!, 20);
		const known = new Set(runs.map((r) => r.id));
		// The panel asks for whichever runs it has expanded; with none named it opens on the newest.
		const wanted = (url.searchParams.get('run_ids') ?? '')
			.split(',')
			.filter((rid) => known.has(rid));
		const ids = (wanted.length ? wanted : runs.slice(0, 1).map((r) => r.id)).slice(
			0,
			MAX_OPEN_TIMELINES
		);
		return json({
			runs: runs.map(agentRunPayload),
			// Keyed by run id: one request refreshes every expanded box at once.
			timelines: Object.fromEntries(ids.map((rid) => [rid, runTimeline(rid)]))
		});
	}),

	'/api/instances/:id/attention/clear': mutationRoute('POST', ({ params }) => {
		clearAttention(params.id!);
		return { ok: true };
	}),

	// Token-authed instead of Basic Auth (see auth.server.ts); the token rides in a
	// header rather than the query string so it stays out of request logs.
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
		// One uniform 403, constant-time — otherwise an attacker could enumerate instance ids.
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

	...proxyRoutes,

	...mcpRoutes,

	...(process.env.MODE === 'development'
		? {
				'/debug': Mochi.page('./src/pages/UI.svelte', {
					// Feed the showcase the real auth providers so CredMenu mirrors `/`.
					serverProps: async () => ({ preflight: await preflight() })
				})
			}
		: {})
};
