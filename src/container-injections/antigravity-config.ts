import { getOption } from '../lib/db.server.ts';
import {
	appendLinesIfAbsent,
	deepMerge,
	editJsonFile,
	installShellEnvFile,
	linesPresent,
	SHELL_RC_FILES,
	shellSingleQuote
} from '../lib/container-files.server.ts';
import {
	ANTIGRAVITY_SETTINGS_FILE,
	readAntigravitySettings
} from '../lib/antigravity-settings.server.ts';
import {
	readHostAntigravitySettings,
	readHostAntigravitySettingsSync
} from '../lib/host-antigravity.server.ts';
import {
	antigravityPermissionFlags,
	isEffortLevel,
	normalizeAntigravityPermissionMode,
	normalizeEffortSetting,
	type AntigravityPermissionMode,
	type ClaudeEffortLevel,
	type ClaudeEffortSetting
} from '../types.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Exported so the launchers can source it explicitly — see `SOURCE_INJECTED_ENV`. */
export const ENV_FILE_NAME = '.codebay-antigravity-config-env';

/** Variables the launchers and shell alias turn into `--model` / `--effort` when overridden in Settings. */
export const MODEL_ENV_VAR = 'CODEBAY_AGY_MODEL';
export const EFFORT_ENV_VAR = 'CODEBAY_AGY_EFFORT';

export function getAntigravityPermissionMode(): AntigravityPermissionMode {
	return normalizeAntigravityPermissionMode(getOption('antigravity_permission_mode'));
}

export function getAntigravityEffortSetting(): ClaudeEffortSetting {
	return normalizeEffortSetting(getOption('antigravity_effort_level'));
}

export function getAntigravityModelSetting(): string | null {
	return getOption('antigravity_model')?.trim() || null;
}

/**
 * Container `settings.json` guardrail policy per mode. `'default'` disables guardrails inside
 * throwaway containers; `'manual'` and the `--mode` variants keep prompts on.
 */
export function antigravityPermissionSettings(
	mode: AntigravityPermissionMode
): Record<string, unknown> {
	if (mode === 'default') {
		return {
			toolPermission: 'always-proceed',
			agentMode: 'accept-edits',
			artifactReviewPolicy: 'always-proceed',
			allowNonWorkspaceAccess: true,
			enableTerminalSandbox: false
		};
	}
	// A run's `--settings` only overlays the keys it names, so a guarded mode resets what `'default'`
	// loosens; artifactReviewPolicy can't be, since agy rejects every value but the two permissive ones.
	const guarded = { toolPermission: 'request-review', allowNonWorkspaceAccess: false };
	if (mode === 'manual') return { ...guarded, agentMode: '', enableTerminalSandbox: false };
	if (mode === 'auto') return { ...guarded, agentMode: 'auto' };
	return { ...guarded, agentMode: mode, enableTerminalSandbox: false };
}

export interface HostAntigravityConfig {
	model: string | null;
	effortByBase: Record<string, ClaudeEffortLevel>;
	customModelsConfig: Record<string, unknown> | null;
}

/** Extracts safe-to-mirror model/effort preferences from host `settings.json`, skipping host `permissions`. */
export function hostAntigravityConfigFrom(
	settings: Record<string, unknown> | null
): HostAntigravityConfig {
	const model =
		typeof settings?.model === 'string' && settings.model.trim() ? settings.model.trim() : null;
	const effortByBase: Record<string, ClaudeEffortLevel> = {};
	const rawEffort = settings?.effortByBase;
	if (rawEffort && typeof rawEffort === 'object' && !Array.isArray(rawEffort)) {
		for (const [base, level] of Object.entries(rawEffort as Record<string, unknown>)) {
			if (base !== '__proto__' && isEffortLevel(level)) effortByBase[base] = level;
		}
	}
	const rawCustom = settings?.customModelsConfig;
	const customModelsConfig =
		rawCustom && typeof rawCustom === 'object' && !Array.isArray(rawCustom)
			? (rawCustom as Record<string, unknown>)
			: null;
	return { model, effortByBase, customModelsConfig };
}

/**
 * Only returns a fixed Settings effort for MCP `-p` runs. Inheriting `'default'` leaves `--effort`
 * unset so `agy` reads its mirrored `settings.json` without failing on fixed-budget models like
 * Orchestrator, which reject explicit `--effort`.
 */
export function defaultAntigravityRunEffort(): ClaudeEffortLevel | null {
	const setting = getAntigravityEffortSetting();
	return setting === 'default' ? null : setting;
}

export function describeAntigravityDefaultEffort(): string {
	const setting = getAntigravityEffortSetting();
	if (setting !== 'default') return `${setting}, set in Codebay's Antigravity settings`;
	const host = hostAntigravityConfigFrom(readHostAntigravitySettingsSync());
	if (host.model) return `inherited from host Antigravity settings (${host.model})`;
	return "Antigravity's own default";
}

export function antigravitySettingsPatch(opts: {
	mode: AntigravityPermissionMode;
	modelOverride: string | null;
	host: HostAntigravityConfig;
}): Record<string, unknown> {
	const patch: Record<string, unknown> = {
		...antigravityPermissionSettings(opts.mode),
		showTips: false,
		showFeedbackSurvey: false
	};
	const model = opts.modelOverride ?? opts.host.model;
	if (model) patch.model = model;
	if (Object.keys(opts.host.effortByBase).length) patch.effortByBase = opts.host.effortByBase;
	if (opts.host.customModelsConfig) patch.customModelsConfig = opts.host.customModelsConfig;
	return patch;
}

export function antigravityConfigEnvContent(
	modelOverride: string | null,
	effortSetting: ClaudeEffortSetting
): string {
	const lines = [
		modelOverride
			? `export ${MODEL_ENV_VAR}=${shellSingleQuote(modelOverride)}`
			: `unset ${MODEL_ENV_VAR}`,
		effortSetting !== 'default'
			? `export ${EFFORT_ENV_VAR}=${shellSingleQuote(effortSetting)}`
			: `unset ${EFFORT_ENV_VAR}`
	];
	return lines.join('\n') + '\n';
}

/**
 * Keeps a hand-typed `agy` on the same permission mode and Settings overrides the auto-launcher
 * uses; `${VAR:+"$VAR"}` preserves spaces inside model labels like `"Gemini 4 Neon (XHigh)"`.
 */
export function antigravityAliasLine(
	mode: AntigravityPermissionMode = getAntigravityPermissionMode()
): string {
	const perm = antigravityPermissionFlags(mode);
	const head = perm ? `agy ${perm}` : 'agy';
	return (
		`alias agy='${head} ` +
		`\${${MODEL_ENV_VAR}:+--model} \${${MODEL_ENV_VAR}:+"$${MODEL_ENV_VAR}"} ` +
		`\${${EFFORT_ENV_VAR}:+--effort} \${${EFFORT_ENV_VAR}:+"$${EFFORT_ENV_VAR}"}'`
	);
}

/** Applies Antigravity guardrails, host model/effort mirroring, workspace trust, and the `agy` alias. */
export const antigravityConfig: Injection = {
	id: 'antigravity-config',
	label: 'Antigravity config',

	async apply(target, log) {
		const mode = getAntigravityPermissionMode();
		const modelOverride = getAntigravityModelSetting();
		const effortSetting = getAntigravityEffortSetting();
		const host = hostAntigravityConfigFrom(await readHostAntigravitySettings());
		const patch = antigravitySettingsPatch({ mode, modelOverride, host });
		const workspace = target.instance.remote_workspace_folder;

		log(`Configuring Antigravity (${mode} mode)…\n`);
		const settings = await editJsonFile(target, ANTIGRAVITY_SETTINGS_FILE, (current) => {
			const merged = deepMerge(current, patch);
			if (workspace) {
				const existing = Array.isArray(current.trustedWorkspaces)
					? current.trustedWorkspaces.filter((v): v is string => typeof v === 'string')
					: [];
				merged.trustedWorkspaces = existing.includes(workspace)
					? existing
					: [...existing, workspace];
			}
			return merged;
		});
		if (!settings.ok) {
			log(`⚠ Antigravity settings injection failed: ${settings.error}\n`);
			return;
		}

		const env = await installShellEnvFile(
			target,
			ENV_FILE_NAME,
			antigravityConfigEnvContent(modelOverride, effortSetting)
		);
		if (!env.ok) {
			log(`⚠ Antigravity config env setup failed: ${env.error}\n`);
			return;
		}

		const alias = await appendLinesIfAbsent(target, SHELL_RC_FILES, [antigravityAliasLine(mode)]);
		log(
			alias.ok
				? '✓ Antigravity configured in container\n'
				: `⚠ Antigravity alias setup failed: ${alias.error}\n`
		);
	},

	async check(target) {
		const mode = getAntigravityPermissionMode();
		const settings = await readAntigravitySettings(target);
		if (!settings) return false;
		const expected = antigravityPermissionSettings(mode);
		if (settings.toolPermission !== expected.toolPermission) return false;
		const workspace = target.instance.remote_workspace_folder;
		if (workspace) {
			const trusted = Array.isArray(settings.trustedWorkspaces) ? settings.trustedWorkspaces : [];
			if (!trusted.includes(workspace)) return false;
		}
		return linesPresent(target, SHELL_RC_FILES, [antigravityAliasLine(mode)]);
	}
};
