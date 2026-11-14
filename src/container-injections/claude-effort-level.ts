import { getOption } from '../lib/db.server.ts';
import { mergeClaudeSettings, readClaudeSettings } from '../lib/claude-settings.server.ts';
import { installShellEnvFile } from '../lib/container-files.server.ts';
import { execInContainer } from '../lib/exec.server.ts';
import { readHostClaudeSettingsSync } from '../lib/host-claude.server.ts';
import { manualModelConfig } from './claude-code-models.ts';
import { customEndpointConfig } from './claude-code-custom.ts';
import { isEffortLevel, normalizeEffortSetting } from '../types.ts';
import type { ClaudeEffortLevel, ClaudeEffortSetting } from '../types.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Also read by the settings-page `serverProps` to seed the UI. */
export function getClaudeEffortSetting(): ClaudeEffortSetting {
	return normalizeEffortSetting(getOption('claude_effort_level'));
}

/**
 * Claude Code canonicalises `modelSettings` keys, so a family alias covers whichever id it currently
 * points at — the only way to reach the default model without knowing its id.
 */
export const MODEL_FAMILY_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];

/**
 * Mythos has no alias (a `mythos` key is kept literally and matches nothing), so its ids are the
 * floor when reading the installed Claude Code's own catalog fails.
 */
export const FALLBACK_MODEL_IDS = [
	'claude-mythos-5-2',
	'claude-mythos-5-1',
	'claude-mythos-5',
	'claude-mythos-preview'
];

/** Families whose concrete ids are worth a `modelSettings` key; matches `ANTHROPIC_TIER_NAMES`. */
const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'];

/**
 * Lists the model ids baked into the container's own Claude Code, so a model released after this
 * Codebay version is still covered — the catalog ships inside the binary (or cli.js) as string literals.
 */
export const INSTALLED_MODELS_SCRIPT =
	'c=$(command -v claude) && b=$(readlink -f "$c") && ' +
	`LC_ALL=C grep -aoE '"claude-(${MODEL_FAMILIES.join('|')})-[0-9a-z]+(-[0-9a-z]+)*"' "$b" | sort -u`;

/** Dated snapshots canonicalise to their base id, so keying them too would only bloat settings.json. */
export function parseModelIds(stdout: string): string[] {
	const ids = stdout
		.split('\n')
		.map((line) => line.trim().replace(/^"|"$/g, ''))
		.filter((id) => /^claude-[a-z]+-[0-9a-z-]+$/.test(id) && !/-\d{8}$/.test(id));
	return [...new Set(ids)];
}

async function installedModelIds(target: Parameters<Injection['apply']>[0]): Promise<string[]> {
	const res = await execInContainer(target, {
		script: INSTALLED_MODELS_SCRIPT,
		capture: true,
		timeoutMs: 30_000
	});
	return res.ok ? parseModelIds(res.stdout) : [];
}

/** Exported so the launchers can source it explicitly — see `SOURCE_INJECTED_ENV`. */
export const ENV_FILE_NAME = '.codebay-claude-effort-env';

/** The variable the launchers and the `claude` alias turn into `--effort`. */
export const EFFORT_ENV_VAR = 'CODEBAY_CLAUDE_EFFORT';

export interface HostEffort {
	/** Top-level `effortLevel` — Claude Code ≥ 2.1 only applies a user-level one to legacy models. */
	top: ClaudeEffortLevel | null;
	/** `modelSettings.<model>.effortLevel`, which is what `/effort` saves and what current models read. */
	perModel: Record<string, ClaudeEffortLevel>;
}

export function hostEffortFrom(settings: Record<string, unknown> | null): HostEffort {
	const top = isEffortLevel(settings?.effortLevel) ? settings.effortLevel : null;
	const perModel: Record<string, ClaudeEffortLevel> = {};
	const models = settings?.modelSettings;
	if (models && typeof models === 'object' && !Array.isArray(models)) {
		for (const [model, entry] of Object.entries(models as Record<string, unknown>)) {
			const level = (entry as { effortLevel?: unknown } | null)?.effortLevel;
			if (model !== '__proto__' && isEffortLevel(level)) perModel[model] = level;
		}
	}
	return { top, perModel };
}

/** `max` is session-only in Claude Code — settings.json silently drops it — so it rides `--effort`. */
const persistable = (level: ClaudeEffortLevel | null) => (level === 'max' ? null : level);

/**
 * The settings.json patch for a container. Claude Code no longer applies a user-level top-level
 * `effortLevel` to current models, so the level is spread across every key in `knownModels` (aliases
 * and concrete ids alike), with the host's own per-model entries winning when inheriting.
 */
export function effortSettingsPatch(
	setting: ClaudeEffortSetting,
	host: HostEffort,
	knownModels: string[]
): { effortLevel?: ClaudeEffortLevel; modelSettings?: Record<string, { effortLevel: string }> } {
	const table: Record<string, ClaudeEffortLevel> = {};
	let top: ClaudeEffortLevel | null;
	if (setting === 'default') {
		top = persistable(host.top);
		if (top) for (const key of [...MODEL_FAMILY_ALIASES, ...knownModels]) table[key] = top;
		for (const [model, level] of Object.entries(host.perModel)) {
			const kept = persistable(level);
			if (kept) table[model] = kept;
		}
	} else {
		top = persistable(setting);
		const keys = [...MODEL_FAMILY_ALIASES, ...Object.keys(host.perModel), ...knownModels];
		if (top) for (const key of keys) table[key] = top;
	}
	const patch: ReturnType<typeof effortSettingsPatch> = {};
	if (top) patch.effortLevel = top;
	if (Object.keys(table).length) {
		patch.modelSettings = Object.fromEntries(
			Object.entries(table).map(([model, effortLevel]) => [model, { effortLevel }])
		);
	}
	return patch;
}

/**
 * The single level a run should pass as `--effort` when the caller names none: the fixed setting,
 * or the host's level when every entry agrees. Null means the host's levels differ per model, so the
 * container's settings.json (which carries the same table) resolves it per model instead.
 */
export function uniformEffort(
	setting: ClaudeEffortSetting,
	host: HostEffort
): ClaudeEffortLevel | null {
	if (setting !== 'default') return setting;
	const levels = new Set([...(host.top ? [host.top] : []), ...Object.values(host.perModel)]);
	return levels.size === 1 ? ([...levels][0] ?? null) : null;
}

/** Ids the container may run that no family alias is guaranteed to cover (Bedrock ids, pinned models). */
function configuredModels(): string[] {
	const custom = customEndpointConfig();
	const ids = [
		...Object.values(manualModelConfig() ?? {}),
		...(custom
			? [custom.opusModel, custom.sonnetModel, custom.haikuModel, custom.defaultModel]
			: []),
		readHostClaudeSettingsSync()?.model
	];
	return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))];
}

const hostEffort = () => hostEffortFrom(readHostClaudeSettingsSync());

/** What an MCP run passes as `--effort` when its caller omits one. */
export function defaultRunEffort(): ClaudeEffortLevel | null {
	return uniformEffort(getClaudeEffortSetting(), hostEffort());
}

/** The configured default in words, for the MCP descriptors — read live on every `tools/list`. */
export function describeDefaultEffort(): string {
	const setting = getClaudeEffortSetting();
	const host = hostEffort();
	const level = uniformEffort(setting, host);
	if (setting !== 'default') return `${level}, set in Codebay's settings`;
	if (level) return `${level}, inherited from the host's Claude Code settings`;
	const entries = Object.entries(host.perModel).map(([model, l]) => `${model}: ${l}`);
	if (host.top) entries.push(`others: ${host.top}`);
	return entries.length
		? `inherited per model from the host's Claude Code settings — ${entries.join(', ')}`
		: "Claude Code's own per-model default, since neither Codebay nor the host sets one";
}

/** `installed` is only read at apply time; the health check skips the exec and verifies the rest. */
function containerPatch(installed: string[] = []) {
	const known = [...new Set([...FALLBACK_MODEL_IDS, ...configuredModels(), ...installed])];
	return effortSettingsPatch(getClaudeEffortSetting(), hostEffort(), known);
}

/** Only `max` needs the env var — every other level is already in settings.json. */
function envFileContent(): string {
	const level = uniformEffort(getClaudeEffortSetting(), hostEffort());
	return level === 'max' ? `export ${EFFORT_ENV_VAR}=max\n` : `unset ${EFFORT_ENV_VAR}\n`;
}

/** Writes Claude Code's effort defaults into the container so new sessions start at the chosen effort. */
export const claudeEffortLevel: Injection = {
	id: 'claude-effort-level',
	label: 'effort level',

	async apply(target, log) {
		const setting = getClaudeEffortSetting();
		const installed = await installedModelIds(target);
		const patch = containerPatch(installed);
		log(`Setting Claude effort level (${describeDefaultEffort()})…\n`);
		const env = await installShellEnvFile(target, ENV_FILE_NAME, envFileContent());
		const result = Object.keys(patch).length
			? await mergeClaudeSettings(target, patch)
			: { ok: true as const };
		const error = !result.ok ? result.error : !env.ok ? env.error : null;
		log(
			error
				? `⚠ Claude effort level injection failed: ${error}\n`
				: setting === 'default' && !Object.keys(patch).length
					? '✓ Host sets no effort level; Claude Code keeps its own default\n'
					: `✓ Claude effort level configured in container (${installed.length} model ids from the installed Claude Code)\n`
		);
	},

	async check(target) {
		const { modelSettings = {}, effortLevel } = containerPatch();
		const settings = await readClaudeSettings(target);
		const current = (settings?.modelSettings ?? {}) as Record<string, { effortLevel?: unknown }>;
		return (
			(effortLevel === undefined || settings?.effortLevel === effortLevel) &&
			Object.entries(modelSettings).every(
				([model, entry]) => current[model]?.effortLevel === entry.effortLevel
			)
		);
	}
};
