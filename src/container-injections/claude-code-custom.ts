import { getOption } from '../lib/db.server.ts';
import {
	containerFileExists,
	deepMerge,
	editJsonFile,
	installShellEnvFile
} from '../lib/container-files.server.ts';
import { CLAUDE_JSON_FILE } from '../lib/claude-settings.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Mirrors the reference launcher script (claude-code.sh); each is overridable in Settings. */
export const DEFAULT_OPUS_MODEL = 'eu.anthropic.claude-opus-4-8';
export const DEFAULT_SONNET_MODEL = 'eu.anthropic.claude-sonnet-4-6';
export const DEFAULT_HAIKU_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
export const DEFAULT_SMALL_FAST_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
export const DEFAULT_MODEL = 'opusplan';

/** Null means "skip the injection" — disabled, or a blank base URL or token. */
export function customEndpointConfig(): {
	baseUrl: string;
	token: string;
	opusModel: string;
	sonnetModel: string;
	haikuModel: string;
	smallFastModel: string;
	defaultModel: string;
} | null {
	if (getOption('custom_endpoint_enabled') !== '1') return null;
	const baseUrl = getOption('custom_endpoint_base_url')?.trim() || '';
	const token = getOption('custom_endpoint_token')?.trim() || '';
	if (!baseUrl || !token) return null;
	return {
		baseUrl,
		token,
		opusModel: getOption('custom_endpoint_opus_model')?.trim() || DEFAULT_OPUS_MODEL,
		sonnetModel: getOption('custom_endpoint_sonnet_model')?.trim() || DEFAULT_SONNET_MODEL,
		haikuModel: getOption('custom_endpoint_haiku_model')?.trim() || DEFAULT_HAIKU_MODEL,
		smallFastModel:
			getOption('custom_endpoint_small_fast_model')?.trim() || DEFAULT_SMALL_FAST_MODEL,
		defaultModel: getOption('custom_endpoint_model')?.trim() || DEFAULT_MODEL
	};
}

const ENV_FILE_NAME = '.codebay-claude-env';

/** The whole file (token included) rides `stdin` inside `installShellEnvFile`, so nothing hits argv. */
function envFileContent(config: NonNullable<ReturnType<typeof customEndpointConfig>>): string {
	return (
		[
			'export DISABLE_AUTOUPDATER=1',
			'export CLAUDE_CODE_USE_BEDROCK=1',
			'export CLAUDE_CODE_SKIP_BEDROCK_AUTH=1',
			`export ANTHROPIC_BEDROCK_BASE_URL=${config.baseUrl}`,
			`export ANTHROPIC_AUTH_TOKEN=${config.token}`,
			`export ANTHROPIC_DEFAULT_OPUS_MODEL=${config.opusModel}`,
			`export ANTHROPIC_DEFAULT_SONNET_MODEL=${config.sonnetModel}`,
			`export ANTHROPIC_DEFAULT_HAIKU_MODEL=${config.haikuModel}`,
			`export ANTHROPIC_SMALL_FAST_MODEL=${config.smallFastModel}`,
			`export ANTHROPIC_MODEL=${config.defaultModel}`
		].join('\n') + '\n'
	);
}

async function injectCustomEndpoint(
	target: ContainerTarget,
	config: NonNullable<ReturnType<typeof customEndpointConfig>>
): Promise<{ ok: boolean; error?: string }> {
	const env = await installShellEnvFile(target, ENV_FILE_NAME, envFileContent(config));
	if (!env.ok) return env;
	// `hasCompletedOnboarding` is what suppresses `claude`'s first-run wizard.
	return editJsonFile(target, CLAUDE_JSON_FILE, (cur) =>
		deepMerge(cur, { hasCompletedOnboarding: true })
	);
}

/** Replaces `claude-code-credentials` in the registry when the custom-endpoint setting is on. */
export const claudeCodeCustom: Injection = {
	id: 'claude-code-custom',
	label: 'LiteLLM + Bedrock',

	auth: {
		hint: 'set the LiteLLM URL + token in Settings',
		async status() {
			const config = customEndpointConfig();
			return {
				available: config !== null,
				source: config ? config.baseUrl : null
			};
		}
	},

	async apply(target, log) {
		const config = customEndpointConfig();
		if (!config) {
			log('⚠ LiteLLM + Bedrock not configured (base URL or token missing); skipped\n');
			return;
		}
		log(`Injecting LiteLLM + Bedrock endpoint (${config.baseUrl})…\n`);
		const result = await injectCustomEndpoint(target, config);
		log(
			result.ok
				? '✓ LiteLLM + Bedrock endpoint configured in container\n'
				: `⚠ LiteLLM + Bedrock injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		return containerFileExists(target, { name: ENV_FILE_NAME });
	}
};
