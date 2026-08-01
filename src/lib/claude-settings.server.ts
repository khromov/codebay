import type { ExecTarget } from './exec.server.ts';
import {
	deepMerge,
	editJsonFile,
	readJsonFile,
	type ContainerFile
} from './container-files.server.ts';

/** A file in `~/.claude` (or wherever `CLAUDE_CONFIG_DIR` points), e.g. settings.json or .bridge-header. */
export const claudeConfigFile = (name: string, mode?: string): ContainerFile => ({
	dir: '${CLAUDE_CONFIG_DIR:-$h/.claude}',
	name,
	mode
});

/** `~/.claude/settings.json`, honoring a `CLAUDE_CONFIG_DIR` override. */
export const CLAUDE_SETTINGS_FILE: ContainerFile = claudeConfigFile('settings.json');

/** `~/.claude.json` sits beside the config dir, not inside it — hence a different dir expr. */
export const CLAUDE_JSON_FILE: ContainerFile = {
	dir: '${CLAUDE_CONFIG_DIR:-$h}',
	name: '.claude.json'
};

/** Deep-merges a patch into settings.json, letting the settings.json injections compose in any order. */
export function mergeClaudeSettings(
	target: ExecTarget,
	patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
	return editJsonFile(target, CLAUDE_SETTINGS_FILE, (current) => deepMerge(current, patch));
}

export function readClaudeSettings(target: ExecTarget): Promise<Record<string, unknown> | null> {
	return readJsonFile<Record<string, unknown>>(target, CLAUDE_SETTINGS_FILE);
}
