import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	ANTIGRAVITY_KEYCHAIN_ACCOUNT,
	ANTIGRAVITY_KEYCHAIN_SERVICE,
	CODEBAY_GEMINI_API_KEY
} from '../lib/config.server.ts';
import { getOption } from '../lib/db.server.ts';
import { checkPresence } from '../lib/exec.server.ts';
import {
	deepMerge,
	editJsonFile,
	installShellEnvFile,
	shellSingleQuote,
	writeContainerFile
} from '../lib/container-files.server.ts';
import {
	ANTIGRAVITY_ONBOARDING_FILE,
	ANTIGRAVITY_TOKEN_FILE,
	mergeAntigravitySettings
} from '../lib/antigravity-settings.server.ts';
import {
	hostAntigravityFile,
	readHostAntigravitySettings
} from '../lib/host-antigravity.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Exported so the launchers can source it explicitly — see `SOURCE_INJECTED_ENV`. */
export const ENV_FILE_NAME = '.codebay-antigravity-env';

/** Pre-completes first-run consumer and enterprise onboarding prompts inside throwaway containers. */
export const ANTIGRAVITY_ONBOARDING_STATE = {
	onboardingComplete: true,
	consumerOnboardingComplete: true,
	enterpriseOnboardingComplete: true
};

/**
 * Decodes what `security -w` / `secret-tool` return for `go-keyring`: macOS hex-encodes secrets
 * containing newlines or non-ASCII, and `go-keyring` wraps base64 payloads with a fixed prefix.
 */
export function decodeKeychainSecret(raw: string): string {
	let value = raw.trim();
	if (value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value)) {
		value = Buffer.from(value, 'hex').toString('utf8').trim();
	}
	if (value.startsWith('go-keyring-base64:')) {
		value = Buffer.from(value.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
	}
	return value;
}

/**
 * Accepts both the CLI's wrapped `StoredToken` (`{ token: { access_token, refresh_token } }`)
 * and legacy flat `oauth2.Token` JSON. Expired access tokens still pass when a refresh token is
 * present, since `agy` refreshes them in-container.
 */
export function isValidOAuthToken(raw: string): boolean {
	try {
		const data = JSON.parse(raw) as {
			token?: { access_token?: unknown; refresh_token?: unknown; expiry?: unknown };
			access_token?: unknown;
			refresh_token?: unknown;
			expiry?: unknown;
		};
		if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
		const tok =
			data.token && typeof data.token === 'object' && !Array.isArray(data.token)
				? data.token
				: data;
		const access = typeof tok.access_token === 'string' && tok.access_token.trim().length > 0;
		const refresh = typeof tok.refresh_token === 'string' && tok.refresh_token.trim().length > 0;
		if (!access && !refresh) return false;
		if (!refresh && typeof tok.expiry === 'string') {
			const expMs = Date.parse(tok.expiry);
			if (!Number.isNaN(expMs) && expMs <= Date.now()) return false;
		}
		return true;
	} catch {
		return false;
	}
}

export type AntigravityCredentials =
	| { kind: 'api-key'; apiKey: string; baseUrl?: string; source: string }
	| { kind: 'oauth'; tokenJson: string; source: string };

/** Exported so `instances.server.ts` can redact a configured Gemini API key from boot logs. */
export function configuredGeminiApiKey(): string | null {
	return getOption('antigravity_gemini_api_key')?.trim() || null;
}

function configuredGeminiBaseUrl(): string | undefined {
	return getOption('antigravity_gemini_base_url')?.trim() || undefined;
}

/** Injectable seam so tests can exercise every platform/discovery path without touching host state. */
export interface CredentialDiscoveryDeps {
	platform?: NodeJS.Platform;
	env?: Record<string, string | undefined>;
	codebayGeminiApiKey?: string;
	readKeychain?: () => Promise<string | null>;
	readHostSettings?: () => Promise<Record<string, unknown> | null>;
	tokenFiles?: () => { path: string; source: string }[];
}

async function defaultReadKeychain(platform: NodeJS.Platform): Promise<string | null> {
	if (platform === 'darwin') {
		return spawnCapture([
			'security',
			'find-generic-password',
			'-s',
			ANTIGRAVITY_KEYCHAIN_SERVICE,
			'-a',
			ANTIGRAVITY_KEYCHAIN_ACCOUNT,
			'-w'
		]);
	}
	if (platform === 'linux') {
		return spawnCapture([
			'secret-tool',
			'lookup',
			'service',
			ANTIGRAVITY_KEYCHAIN_SERVICE,
			'username',
			ANTIGRAVITY_KEYCHAIN_ACCOUNT
		]);
	}
	return null;
}

function defaultTokenFiles(): { path: string; source: string }[] {
	const files = [
		{
			path: hostAntigravityFile('antigravity-oauth-token'),
			source: '~/.gemini/antigravity-cli/antigravity-oauth-token'
		}
	];
	// Skip the standalone fallback when the host dir was explicitly overridden (e.g. custom path / tests).
	if (!getOption('antigravity_config_dir')?.trim()) {
		files.push({
			path: join(homedir(), '.gemini', 'jetski-standalone-oauth-token'),
			source: '~/.gemini/jetski-standalone-oauth-token'
		});
	}
	return files;
}

/**
 * Precedence: Settings Gemini API key > `CODEBAY_GEMINI_API_KEY` > host `modelProvider: "gemini"` +
 * `GEMINI_API_KEY` > host OAuth keyring/file > fallback `GEMINI_API_KEY` env var. Keeping OAuth
 * ahead of an unconfigured host `GEMINI_API_KEY` avoids hijacking signed-in users who merely happen
 * to export that env var for unrelated scripts.
 */
export async function locateAntigravityCredentials(
	deps: CredentialDiscoveryDeps = {}
): Promise<AntigravityCredentials | null> {
	const platform = deps.platform ?? process.platform;
	const env = deps.env ?? process.env;
	const baseUrl = configuredGeminiBaseUrl() || env.GOOGLE_GEMINI_BASE_URL?.trim() || undefined;

	const settingsKey = configuredGeminiApiKey();
	if (settingsKey) {
		return { kind: 'api-key', apiKey: settingsKey, baseUrl, source: 'Settings — Gemini API key' };
	}

	const codebayKey = deps.codebayGeminiApiKey ?? CODEBAY_GEMINI_API_KEY;
	if (codebayKey) {
		return {
			kind: 'api-key',
			apiKey: codebayKey,
			baseUrl,
			source: 'CODEBAY_GEMINI_API_KEY env var'
		};
	}

	const hostEnvKey = env.GEMINI_API_KEY?.trim() || '';
	const hostSettings = await (deps.readHostSettings ?? readHostAntigravitySettings)();
	if (hostSettings?.modelProvider === 'gemini' && hostEnvKey) {
		return {
			kind: 'api-key',
			apiKey: hostEnvKey,
			baseUrl,
			source: 'GEMINI_API_KEY env var (host modelProvider: gemini)'
		};
	}

	const keychainRaw = await (deps.readKeychain ?? (() => defaultReadKeychain(platform)))();
	if (keychainRaw) {
		const decoded = decodeKeychainSecret(keychainRaw);
		if (isValidOAuthToken(decoded)) {
			const label =
				platform === 'darwin'
					? `macOS Keychain — "${ANTIGRAVITY_KEYCHAIN_SERVICE}"`
					: `Linux Secret Service — "${ANTIGRAVITY_KEYCHAIN_SERVICE}"`;
			return { kind: 'oauth', tokenJson: decoded, source: label };
		}
	}

	for (const candidate of (deps.tokenFiles ?? defaultTokenFiles)()) {
		if (!existsSync(candidate.path)) continue;
		try {
			const raw = (await readFile(candidate.path, 'utf8')).trim();
			if (isValidOAuthToken(raw))
				return { kind: 'oauth', tokenJson: raw, source: candidate.source };
		} catch {
			// Unreadable token file — keep searching remaining sources.
		}
	}

	if (hostEnvKey) {
		return { kind: 'api-key', apiKey: hostEnvKey, baseUrl, source: 'GEMINI_API_KEY env var' };
	}

	return null;
}

/**
 * Forces file-based OAuth token storage (Linux containers lack D-Bus/gnome-keyring) and disables
 * background auto-update races in throwaway containers, plus exports Gemini API key vars when used.
 */
export function antigravityEnvFileContent(creds: AntigravityCredentials | null): string {
	const lines = [
		'export AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true',
		'export AGY_CLI_DISABLE_AUTO_UPDATE=true'
	];
	if (creds?.kind === 'api-key') {
		lines.push(`export GEMINI_API_KEY=${shellSingleQuote(creds.apiKey)}`);
		if (creds.baseUrl)
			lines.push(`export GOOGLE_GEMINI_BASE_URL=${shellSingleQuote(creds.baseUrl)}`);
	}
	return lines.join('\n') + '\n';
}

export const LIVE_CREDENTIALS_CHECK =
	'h=$(eval echo ~$(id -un)); ' +
	'f="$h/.gemini/antigravity-cli/antigravity-oauth-token"; ' +
	's="$h/.gemini/antigravity-cli/settings.json"; ' +
	`e="$HOME/${ENV_FILE_NAME}"; ` +
	'if ([ -s "$f" ] && tr -d \'[:space:]\' < "$f" | grep -qE \'"(access_token|refresh_token)":"[^"]\') || ' +
	'(grep -q \'^export GEMINI_API_KEY=\' "$e" 2>/dev/null && [ -s "$s" ] && tr -d \'[:space:]\' < "$s" | grep -q \'"modelProvider":"gemini"\'); ' +
	'then echo 1; else echo 0; fi';

async function injectAntigravityCredentials(
	target: ContainerTarget,
	creds: AntigravityCredentials | null
): Promise<{ ok: boolean; error?: string }> {
	const env = await installShellEnvFile(target, ENV_FILE_NAME, antigravityEnvFileContent(creds));
	if (!env.ok) return env;

	const onboarding = await editJsonFile(target, ANTIGRAVITY_ONBOARDING_FILE, (cur) =>
		deepMerge(cur, ANTIGRAVITY_ONBOARDING_STATE)
	);
	if (!onboarding.ok) return onboarding;

	if (!creds) return { ok: true };

	if (creds.kind === 'oauth') {
		return writeContainerFile(target, ANTIGRAVITY_TOKEN_FILE, creds.tokenJson);
	}

	// `agy` only honors GEMINI_API_KEY when `modelProvider` is explicitly set to `"gemini"`.
	return mergeAntigravitySettings(target, { modelProvider: 'gemini' });
}

export const antigravityCredentials: Injection = {
	id: 'antigravity-credentials',
	label: 'Antigravity',

	auth: {
		hint: 'run `agy` and sign in, or set a Gemini API key in Settings',
		async status() {
			const found = await locateAntigravityCredentials();
			return { available: found !== null, source: found?.source ?? null };
		}
	},

	async apply(target, log) {
		const found = await locateAntigravityCredentials();
		if (!found) {
			log('⚠ No Antigravity credentials found on host; writing container env defaults only\n');
			const base = await injectAntigravityCredentials(target, null);
			if (!base.ok) log(`⚠ Antigravity env setup failed: ${base.error}\n`);
			return;
		}
		log(`Injecting Antigravity credentials (${found.source})…\n`);
		const injected = await injectAntigravityCredentials(target, found);
		log(
			injected.ok
				? '✓ Antigravity authorized in container\n'
				: `⚠ Antigravity auth injection failed: ${injected.error}\n`
		);
	},

	async check(target) {
		return checkPresence(target, LIVE_CREDENTIALS_CHECK);
	}
};
