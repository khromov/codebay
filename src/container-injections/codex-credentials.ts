import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OPENAI_API_KEY } from '../lib/config.server.ts';
import { getOption } from '../lib/db.server.ts';
import { checkPresence, execInContainer, writeSecretFileScript } from '../lib/exec.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

type CodexCredential =
	| { kind: 'auth-file'; value: string; source: string }
	| { kind: 'api-key'; value: string; source: string };

/** Settings override, honored only while manual token entry is enabled. */
function manualOpenAiApiKey(): string | null {
	if (getOption('manual_tokens_enabled') !== '1') return null;
	return getOption('manual_openai_api_key')?.trim() || null;
}

/** Resolve Codex auth without copying any unrelated CODEX_HOME state. */
export async function locateCodexCredential(): Promise<CodexCredential | null> {
	const manual = manualOpenAiApiKey();
	if (manual) return { kind: 'api-key', value: manual, source: 'Settings — OpenAI API key' };
	if (OPENAI_API_KEY) {
		return {
			kind: 'api-key',
			value: OPENAI_API_KEY,
			source: 'CODEBAY_OPENAI_API_KEY env var'
		};
	}

	const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
	const file = join(codexHome, 'auth.json');
	if (!existsSync(file)) return null;
	try {
		const raw = (await readFile(file, 'utf8')).trim();
		const source = process.env.CODEX_HOME?.trim()
			? `${process.env.CODEX_HOME.trim()}/auth.json`
			: '~/.codex/auth.json';
		return raw ? { kind: 'auth-file', value: raw, source } : null;
	} catch {
		return null;
	}
}

async function injectCodexCredential(
	target: ContainerTarget,
	credential: CodexCredential
): Promise<{ ok: boolean; error?: string }> {
	const home = 'h=$(eval echo ~$(id -un)); d="${CODEX_HOME:-$h/.codex}"; ';
	const script =
		credential.kind === 'auth-file'
			? home + writeSecretFileScript('$d', 'auth.json', '600')
			: 'command -v codex >/dev/null 2>&1 || { echo "codex CLI not found" >&2; exit 1; }; ' +
				'printf \'%s\' "$CODEBAY_STDIN" | codex login --with-api-key';
	const result = await execInContainer(target, { script, stdin: credential.value });
	return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export const codexCredentials: Injection = {
	id: 'codex-credentials',
	label: 'Codex',

	auth: {
		hint: 'run `codex login` or set an OpenAI API key',
		async status() {
			const found = await locateCodexCredential();
			return { available: found !== null, source: found?.source ?? null };
		}
	},

	async apply(target, log) {
		const found = await locateCodexCredential();
		if (!found) {
			log('⚠ No file-backed Codex auth or OpenAI API key found; skipped auth injection\n');
			return;
		}
		log(`Injecting Codex credentials from ${found.source}…\n`);
		const injected = await injectCodexCredential(target, found);
		log(
			injected.ok
				? '✓ Codex authorized in container\n'
				: `⚠ Codex auth injection failed: ${injected.error}\n`
		);
	},

	async check(target) {
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CODEX_HOME:-$h/.codex}"; ' +
				'[ -s "$d/auth.json" ] && echo 1 || echo 0'
		);
	}
};
