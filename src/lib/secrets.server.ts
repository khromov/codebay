import { customEnvVarValues } from '../container-injections/custom-env-vars.ts';

/**
 * Cached so the redaction on every log chunk doesn't re-read the DB. Rebuilt lazily after the
 * settings action invalidates it; values shorter than 4 chars are skipped so a trivially short
 * secret can't blank out unrelated log text, and longest-first avoids a short value masking a
 * substring of a longer one.
 */
let secretValuesCache: string[] | null = null;

/**
 * Values that never came from Settings — a repo's `codebay.json` override resolved out of the host
 * environment, say — so `customEnvVarValues()` can't find them on its own.
 */
const registered = new Set<string>();

/** Call as soon as a secret is resolved, so it redacts from the log lines that follow. */
export function registerSecretValue(value: string): void {
	if (value.length < 4 || registered.has(value)) return;
	registered.add(value);
	secretValuesCache = null;
}

function getSecretValues(): string[] {
	if (secretValuesCache === null) {
		secretValuesCache = [...new Set([...customEnvVarValues(), ...registered])]
			.filter((v) => v.length >= 4)
			.sort((a, b) => b.length - a.length);
	}
	return secretValuesCache;
}

/** Call after the custom-env-vars setting changes so newly-added values redact from the next boot. */
export function invalidateSecretValues(): void {
	secretValuesCache = null;
}

/** Exported for tests; the boot flow reaches it only through `appendLog`. */
export function redactSecrets(text: string): string {
	for (const value of getSecretValues()) text = text.split(value).join('••••');
	return text;
}
