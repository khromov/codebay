import { getOption } from '../lib/db.server.ts';
import { installShellEnvFile, shellSingleQuote } from '../lib/container-files.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** The option key → Claude env var mapping; order is the field order in Settings. */
const MODEL_ENV: Array<[key: string, env: string]> = [
	['manual_opus_model', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
	['manual_sonnet_model', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
	['manual_haiku_model', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
	['manual_small_fast_model', 'ANTHROPIC_SMALL_FAST_MODEL'],
	['manual_model', 'ANTHROPIC_MODEL']
];

/**
 * Only for the standard (subscription) path — null when disabled, when LiteLLM
 * owns the models instead, or when no field is filled (nothing to export).
 */
export function manualModelConfig(): Record<string, string> | null {
	if (getOption('manual_model_override_enabled') !== '1') return null;
	if (getOption('custom_endpoint_enabled') === '1') return null;
	const filled: Record<string, string> = {};
	for (const [key, env] of MODEL_ENV) {
		const value = getOption(key)?.trim();
		if (value) filled[env] = value;
	}
	return Object.keys(filled).length ? filled : null;
}

const ENV_FILE_NAME = '.codebay-claude-models-env';

function injectModels(
	target: ContainerTarget,
	config: Record<string, string>
): Promise<{ ok: boolean; error?: string }> {
	const content =
		Object.entries(config)
			.map(([env, value]) => `export ${env}=${shellSingleQuote(value)}`)
			.join('\n') + '\n';
	return installShellEnvFile(target, ENV_FILE_NAME, content);
}

/** Sets Claude model env vars on the standard path; skipped when LiteLLM is active. */
export const claudeCodeModels: Injection = {
	id: 'claude-code-models',
	label: 'Model override',

	async apply(target, log) {
		const config = manualModelConfig();
		if (!config) return;
		log(`Injecting Claude model override (${Object.keys(config).join(', ')})…\n`);
		const result = await injectModels(target, config);
		log(
			result.ok
				? '✓ Claude model override configured in container\n'
				: `⚠ Claude model override injection failed: ${result.error}\n`
		);
	}
};
