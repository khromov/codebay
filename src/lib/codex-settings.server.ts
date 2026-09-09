import { parse, stringify } from 'smol-toml';
import type { ExecTarget } from './exec.server.ts';
import {
	deepMerge,
	readContainerFileResult,
	writeContainerFile,
	type ContainerFile
} from './container-files.server.ts';

export const codexConfigFile = (name: string, mode = '600'): ContainerFile => ({
	dir: '${CODEX_HOME:-$h/.codex}',
	name: name.replace(/[\\$`"]/g, '\\$&'),
	mode
});

/** Replace managed overrides so omitted settings revert on persisted Codex homes too. */
export function mergeCodexConfigValues(
	current: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	const base = { ...current };
	for (const key of ['model', 'model_reasoning_effort', 'model_verbosity']) delete base[key];
	if (base.model_provider === 'codebay') delete base.model_provider;
	const providers = base.model_providers;
	if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
		const remaining = { ...(providers as Record<string, unknown>) };
		delete remaining.codebay;
		if (Object.keys(remaining).length) base.model_providers = remaining;
		else delete base.model_providers;
	}
	return deepMerge(base, patch);
}

export async function mergeCodexConfig(target: ExecTarget, patch: Record<string, unknown>) {
	const file = codexConfigFile('config.toml');
	const read = await readContainerFileResult(target, file);
	if (!read.ok) return read;
	try {
		const current = read.content ? parse(read.content) : {};
		return await writeContainerFile(
			target,
			file,
			stringify(mergeCodexConfigValues(current, patch))
		);
	} catch {
		return {
			ok: false,
			error: 'Could not merge Codex config.toml; the existing file was preserved'
		};
	}
}
