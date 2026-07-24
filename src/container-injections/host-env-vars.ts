import { getOption } from '../lib/db.server.ts';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Absolute path of the env file written inside the container. */
const ENV_FILE = '~/.codebay-host-env';

/** A host env var the user asked to forward, resolved against this process's env. */
interface ResolvedVar {
	name: string;
	value: string;
}

/**
 * Parse the JSON-encoded name list stored under `host_env_var_names`, tolerating a
 * missing/malformed value (returns `[]`). Shared by the injection itself and the
 * `/settings` serverProps, which needs the same list to compute host presence
 * without duplicating the parsing logic.
 */
export function parseHostEnvVarNames(raw: string | null): string[] {
	try {
		const parsed = JSON.parse(raw ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Whether each name currently has a non-empty value on this process's env. Shared
 * by the `/settings` serverProps (initial render) and the settings mutation route
 * (so the client can refresh presence after adding/removing a name without a full
 * page reload).
 */
export function hostEnvVarPresence(names: string[]): Record<string, boolean> {
	return Object.fromEntries(
		names.map((name) => [name, Bun.env[name] !== undefined && Bun.env[name] !== ''])
	);
}

/**
 * Read the host-env-vars configuration from the options store. Returns null when
 * the feature is disabled or when no configured name has a value on this process's
 * env — both are skip conditions for the injection. `resolved` holds only the names
 * that actually have a non-empty value on the host; the rest are reported back via
 * `missing` so `apply()` can log them without ever logging a value.
 */
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

/**
 * Write the host-env-vars file and source it from both ~/.bashrc and ~/.zshrc,
 * guarded so re-apply never duplicates the source line — same shape as
 * `claude-code-custom.ts`'s endpoint env file.
 *
 * Secret handling: every resolved `NAME=VALUE` line is newline-joined into a single
 * payload and sent as `stdin` (scrubbed `$CODEBAY_STDIN`, never argv) — values never
 * appear in `docker inspect`, the process arg list, or the options DB (only names
 * are persisted there). The env file itself is `chmod 600`.
 */
async function injectHostEnvVars(
	target: ContainerTarget,
	resolved: ResolvedVar[]
): Promise<{ ok: boolean; error?: string }> {
	// Single-quote each value so arbitrary host values (spaces, `$`, backticks,
	// newlines) source as literal data instead of being re-parsed as shell — the
	// file is sourced by every interactive shell. Names are already validated to
	// `[A-Za-z_][A-Za-z0-9_]*` so they need no quoting. `'` inside a value is
	// closed, escaped as `\'`, and reopened (the standard `'\''` dance).
	const payload = resolved
		.map(({ name, value }) => `export ${name}='${value.replaceAll("'", "'\\''")}'`)
		.join('\n');
	const script =
		'set -e; f=$(eval echo "' +
		ENV_FILE +
		'"); ' +
		// Write the env file verbatim from $CODEBAY_STDIN — it already holds
		// fully-formed `export NAME=VALUE` lines.
		'printf \'%s\\n\' "$CODEBAY_STDIN" > "$f"; chmod 600 "$f"; ' +
		// Source the file from both rc files, guarded against duplicates.
		'h=$(eval echo ~$(id -un)); src="[ -f \\"$f\\" ] && . \\"$f\\""; ' +
		'for rc in "$h/.bashrc" "$h/.zshrc"; do ' +
		'grep -qF "$src" "$rc" 2>/dev/null || printf \'%s\\n\' "$src" >> "$rc"; ' +
		'done';

	const res = await execInContainer(target, {
		script,
		stdin: payload,
		args: ['host-env-vars']
	});
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Forward a user-chosen set of host environment variables into the container's
 * interactive shells. The user configures variable *names* only (in Settings);
 * values are read fresh from this process's environment at apply time and never
 * stored in the options DB. Skipped (with a log line) when the feature is disabled,
 * unconfigured, or none of the configured names resolve on the host.
 *
 * No `auth` block: unlike git identity or GitHub/Claude credentials, this isn't a
 * host credential the manager discovers — it's an opt-in feature that's off by
 * default, so it shouldn't make the global credentials chip (which flags missing
 * *required* auth) look broken. Its status lives entirely in the Settings card.
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
		return checkPresence(target, `f=$(eval echo "${ENV_FILE}"); [ -s "$f" ] && echo 1 || echo 0`);
	}
};
