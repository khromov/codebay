import { getOption } from '../lib/db.server.ts';
import {
	containerFileExists,
	installShellEnvFile,
	shellSingleQuote
} from '../lib/container-files.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

const ENV_FILE_NAME = '.codebay-host-env';

interface ResolvedVar {
	name: string;
	value: string;
}

/** Exported so `/settings` computes host presence from the same parse the injection uses. */
export function parseHostEnvVarNames(raw: string | null): string[] {
	try {
		const parsed = JSON.parse(raw ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
	} catch {
		return [];
	}
}

/** Reports presence only — a value must never cross to the client. */
export function hostEnvVarPresence(names: string[]): Record<string, boolean> {
	return Object.fromEntries(
		names.map((name) => [name, Bun.env[name] !== undefined && Bun.env[name] !== ''])
	);
}

/** Null means "skip the injection"; `missing` lets `apply()` log names without logging values. */
export function hostEnvVarsConfig(): {
	names: string[];
	resolved: ResolvedVar[];
	missing: string[];
} | null {
	if (getOption('host_env_vars_enabled') !== '1') return null;
	const names = parseHostEnvVarNames(getOption('host_env_var_names'));
	if (!names.length) return null;
	const resolved: ResolvedVar[] = [];
	const missing: string[] = [];
	for (const name of names) {
		const value = Bun.env[name];
		if (value !== undefined && value !== '') resolved.push({ name, value });
		else missing.push(name);
	}
	if (!resolved.length) return null;
	return { names, resolved, missing };
}

/** Values ride `stdin` as one payload, so they reach neither argv nor `docker inspect`. */
function injectHostEnvVars(
	target: ContainerTarget,
	resolved: ResolvedVar[]
): Promise<{ ok: boolean; error?: string }> {
	// Every interactive shell sources this file, so values must be single-quoted to stay literal.
	const content =
		resolved.map(({ name, value }) => `export ${name}=${shellSingleQuote(value)}`).join('\n') +
		'\n';
	return installShellEnvFile(target, ENV_FILE_NAME, content);
}

/**
 * Only names are persisted — values are read fresh from this process's env at apply time.
 * No `auth` block on purpose: this is opt-in, so it must not flag the required-auth chip.
 */
export const hostEnvVars: Injection = {
	id: 'host-env-vars',
	label: 'host env vars',

	async apply(target, log) {
		const config = hostEnvVarsConfig();
		if (!config) {
			log('⚠ Host env vars not configured (disabled or none resolve on host); skipped\n');
			return;
		}
		log(
			`Injecting ${config.resolved.length} host env var(s): ${config.resolved.map((r) => r.name).join(', ')}…\n`
		);
		if (config.missing.length) {
			log(`⚠ Not set on host, skipped: ${config.missing.join(', ')}\n`);
		}
		const result = await injectHostEnvVars(target, config.resolved);
		log(
			result.ok
				? '✓ host env vars injected\n'
				: `⚠ host env vars injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		return containerFileExists(target, { name: ENV_FILE_NAME });
	}
};
