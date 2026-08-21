import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getOption } from '../lib/db.server.ts';
import { writeContainerFile } from '../lib/container-files.server.ts';
import {
	claudeConfigFile,
	mergeClaudeSettings,
	readClaudeSettings
} from '../lib/claude-settings.server.ts';
import { readHostClaudeSettings } from './claude-statusline.ts';
import { normalizeOutputStyle } from '../types.ts';
import type { ClaudeOutputStyle } from '../types.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Also read by the settings-page `serverProps` to seed the UI. */
export function getClaudeOutputStyle(): ClaudeOutputStyle {
	return normalizeOutputStyle(getOption('claude_output_style'));
}

/** The `outputStyle` actually applied: the setting itself, the host's value when inheriting, or null. */
export async function resolveEffectiveOutputStyle(): Promise<string | null> {
	const setting = getClaudeOutputStyle();
	if (setting === 'none') return null;
	if (setting !== 'default') return setting;
	const style = (await readHostClaudeSettings())?.outputStyle;
	return typeof style === 'string' && style.trim() ? style.trim() : null;
}

/** The host's custom output-style definitions, so a non-built-in name resolves inside the container. */
export async function readHostOutputStyleFiles(): Promise<{ name: string; content: string }[]> {
	const dir = join(homedir(), '.claude', 'output-styles');
	let names: string[];
	try {
		names = (await readdir(dir)).filter((n) => n.endsWith('.md'));
	} catch {
		return [];
	}
	const files = await Promise.all(
		names.map(async (name) => {
			try {
				return { name, content: await readFile(join(dir, name), 'utf8') };
			} catch {
				return null;
			}
		})
	);
	return files.filter((f): f is { name: string; content: string } => f !== null);
}

/** Writes Claude Code's `outputStyle` default into the container, mirroring host custom-style files. */
export const claudeOutputStyle: Injection = {
	id: 'claude-output-style',
	label: 'output style',

	async apply(target: ContainerTarget, log) {
		const style = await resolveEffectiveOutputStyle();
		if (!style) {
			log('No Claude output style to apply; skipped\n');
			return;
		}
		for (const file of await readHostOutputStyleFiles()) {
			await writeContainerFile(
				target,
				claudeConfigFile(`output-styles/${file.name}`, '644'),
				file.content
			);
		}
		log(`Setting Claude output style (${style})…\n`);
		const result = await mergeClaudeSettings(target, { outputStyle: style });
		log(
			result.ok
				? '✓ Claude output style configured in container\n'
				: `⚠ Claude output style injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		const expected = await resolveEffectiveOutputStyle();
		const settings = await readClaudeSettings(target);
		const actual = settings?.outputStyle;
		return expected === null ? actual == null : actual === expected;
	}
};
