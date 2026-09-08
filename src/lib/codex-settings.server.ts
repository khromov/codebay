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

export async function mergeCodexConfig(target: ExecTarget, patch: Record<string, unknown>) {
	const file = codexConfigFile('config.toml');
	const read = await readContainerFileResult(target, file);
	if (!read.ok) return read;
	try {
		const current = read.content ? parse(read.content) : {};
		return await writeContainerFile(target, file, stringify(deepMerge(current, patch)));
	} catch {
		return {
			ok: false,
			error: 'Could not merge Codex config.toml; the existing file was preserved'
		};
	}
}
