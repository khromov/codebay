import { getOption } from '../lib/db.server.ts';
import { mergeClaudeSettings, readClaudeSettings } from '../lib/claude-settings.server.ts';
import { readHostClaudeSettings } from './claude-statusline.ts';
import type { Injection } from '../lib/injections.server.ts';

/** The app's own model config (manual override / LiteLLM) exports ANTHROPIC_MODEL, which wins over settings.json. */
function appOwnsModel(): boolean {
	return (
		getOption('manual_model_override_enabled') === '1' ||
		getOption('custom_endpoint_enabled') === '1'
	);
}

/** The `model` default from host ~/.claude/settings.json, or null when unset or app-owned. */
export async function hostClaudeModel(): Promise<string | null> {
	if (appOwnsModel()) return null;
	const settings = await readHostClaudeSettings();
	const model = settings?.model;
	return typeof model === 'string' && model.trim() ? model.trim() : null;
}

/** Mirrors the host's default `model` into the container so subscription instances match the host. */
export const claudeModel: Injection = {
	id: 'claude-model',
	label: 'model default',

	async apply(target, log) {
		const model = await hostClaudeModel();
		if (!model) return;
		log(`Injecting Claude model default (${model})…\n`);
		const result = await mergeClaudeSettings(target, { model });
		log(
			result.ok
				? '✓ Claude model default configured in container\n'
				: `⚠ Claude model default injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		const settings = await readClaudeSettings(target);
		return typeof settings?.model === 'string' && settings.model.trim() !== '';
	}
};
