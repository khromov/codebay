import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';
import { getOption } from './db.server.ts';
import { expandTilde } from './host-claude.server.ts';
import { spawnCapture } from './spawn.server.ts';

export function hostCodexDir(): string {
	return expandTilde(
		getOption('codex_config_dir')?.trim() ||
			process.env.CODEX_HOME?.trim() ||
			join(homedir(), '.codex')
	);
}

export async function readHostCodexConfig(): Promise<Record<string, unknown>> {
	try {
		return parse(await readFile(join(hostCodexDir(), 'config.toml'), 'utf8'));
	} catch {
		return {};
	}
}

export function validCodexAuth(raw: string): boolean {
	try {
		const data = JSON.parse(raw);
		return (
			(typeof data?.OPENAI_API_KEY === 'string' && !!data.OPENAI_API_KEY.trim()) ||
			(typeof data?.tokens?.access_token === 'string' && !!data.tokens.access_token.trim())
		);
	} catch {
		return false;
	}
}

export async function locateCodexCredential(): Promise<{ value: string; source: string } | null> {
	const manual = getOption('codex_api_key')?.trim();
	const key =
		manual || process.env.CODEBAY_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
	if (key)
		return {
			value: JSON.stringify({ OPENAI_API_KEY: key }),
			source: manual ? 'Settings — OpenAI API key' : 'OpenAI API key environment variable'
		};
	const dir = hostCodexDir();
	const config = await readHostCodexConfig();
	const storage = config.cli_auth_credentials_store ?? 'file';
	if (process.platform === 'darwin' && storage !== 'file') {
		const canonical = await realpath(dir).catch(() => dir);
		const account = `codex|${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
		const value = await spawnCapture([
			'security',
			'find-generic-password',
			'-s',
			'Codex Auth',
			'-a',
			account,
			'-w'
		]);
		if (value && validCodexAuth(value)) return { value, source: 'macOS Keychain — Codex Auth' };
	}
	try {
		const value = await readFile(join(dir, 'auth.json'), 'utf8');
		if (validCodexAuth(value)) return { value, source: `${dir}/auth.json` };
	} catch {
		/* Login can be completed inside the container when the host has no exportable credential. */
	}
	return null;
}
