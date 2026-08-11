import { getOption } from '../lib/db.server.ts';
import { checkPresence } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

export interface CustomEnvVar {
	name: string;
	value: string;
}

/** Same rule the host-env-vars name list and the settings action validate against. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Exported so `/settings` and the log-redaction step parse the stored list the same way. */
export function parseCustomEnvVars(raw: string | null): CustomEnvVar[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw ?? '[]');
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const out: CustomEnvVar[] = [];
	for (const entry of parsed) {
		const name = (entry as CustomEnvVar)?.name;
		const value = (entry as CustomEnvVar)?.value;
		if (typeof name === 'string' && typeof value === 'string' && NAME_RE.test(name)) {
			out.push({ name, value });
		}
	}
	return out;
}

/** Null means "skip" — neither `containerEnv` nor the injection render anything. */
export function customEnvVarsConfig(): { vars: CustomEnvVar[] } | null {
	if (getOption('custom_env_vars_enabled') !== '1') return null;
	const vars = parseCustomEnvVars(getOption('custom_env_vars')).filter((v) => v.value !== '');
	return vars.length ? { vars } : null;
}

/** The secret values eligible for log redaction — only while the feature is enabled. */
export function customEnvVarValues(): string[] {
	return customEnvVarsConfig()?.vars.map((v) => v.value) ?? [];
}

/** Names ride argv (never a value), and `printenv` output is discarded so no value is ever echoed. */
const PRESENCE_SCRIPT =
	'for n in "$@"; do printenv "$n" >/dev/null 2>&1 || { echo 0; exit 0; }; done; echo 1';

/**
 * The values themselves are injected via devcontainer.json `containerEnv` at container-create time
 * (a post-up injection can't set container-wide env); this module verifies they landed and draws
 * the health row. No `auth` block: values come from Settings, not a discovered host dependency.
 */
export const customEnvVars: Injection = {
	id: 'custom-env-vars',
	label: 'custom env vars',

	async apply(target, log) {
		const config = customEnvVarsConfig();
		if (!config) {
			log('⚠ Custom env vars not configured (disabled or none set); skipped\n');
			return;
		}
		const names = config.vars.map((v) => v.name);
		log(`Verifying ${names.length} custom env var(s) via containerEnv: ${names.join(', ')}…\n`);
		const present = await checkPresence(target, PRESENCE_SCRIPT, ['custom-env-vars', ...names]);
		log(
			present
				? '✓ custom env vars present in the container\n'
				: '⚠ custom env vars not visible (containerEnv may not apply to this base image)\n'
		);
	},

	async check(target) {
		const config = customEnvVarsConfig();
		if (!config) return false;
		return checkPresence(target, PRESENCE_SCRIPT, [
			'custom-env-vars',
			...config.vars.map((v) => v.name)
		]);
	}
};
