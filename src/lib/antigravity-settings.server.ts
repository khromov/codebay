import type { ExecTarget } from './exec.server.ts';
import {
	deepMerge,
	editJsonFile,
	readJsonFile,
	type ContainerFile
} from './container-files.server.ts';

/** A file in `~/.gemini/antigravity-cli` (settings.json, oauth token, etc.). */
export const antigravityConfigFile = (name: string, mode?: string): ContainerFile => ({
	dir: '$h/.gemini/antigravity-cli',
	name,
	mode
});

export const ANTIGRAVITY_SETTINGS_FILE: ContainerFile = antigravityConfigFile(
	'settings.json',
	'600'
);

/** `agy` reads first-run state from `cache/`; a top-level `onboarding.json` is ignored and the wizard still runs. */
export const ANTIGRAVITY_ONBOARDING_FILE: ContainerFile = {
	dir: '$h/.gemini/antigravity-cli/cache',
	name: 'onboarding.json',
	mode: '600'
};

export const ANTIGRAVITY_TOKEN_FILE: ContainerFile = antigravityConfigFile(
	'antigravity-oauth-token',
	'600'
);

/** Antigravity CLI loads global hooks from `~/.gemini/config/hooks.json`, never from `settings.json`. */
export const ANTIGRAVITY_HOOKS_FILE: ContainerFile = {
	dir: '$h/.gemini/config',
	name: 'hooks.json',
	mode: '600'
};

export function mergeAntigravitySettings(
	target: ExecTarget,
	patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
	return editJsonFile(target, ANTIGRAVITY_SETTINGS_FILE, (current) => deepMerge(current, patch));
}

export function readAntigravitySettings(
	target: ExecTarget
): Promise<Record<string, unknown> | null> {
	return readJsonFile<Record<string, unknown>>(target, ANTIGRAVITY_SETTINGS_FILE);
}

export function mergeAntigravityHooks(
	target: ExecTarget,
	patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
	return editJsonFile(target, ANTIGRAVITY_HOOKS_FILE, (current) => deepMerge(current, patch));
}

export function readAntigravityHooks(target: ExecTarget): Promise<Record<string, unknown> | null> {
	return readJsonFile<Record<string, unknown>>(target, ANTIGRAVITY_HOOKS_FILE);
}
