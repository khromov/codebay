import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getOption } from './db.server.ts';
import { expandTilde } from './host-claude.server.ts';
import { normalizeAgentProvider, type AgentProvider } from '../types.ts';

/** Opt-in: off by default so Claude-only setups see zero behaviour change. */
export function antigravityEnabled(): boolean {
	return getOption('antigravity_enabled') === '1';
}

/** Falls back to Claude whenever Antigravity is disabled so launchers never target an uninstalled CLI. */
export function getDefaultAgent(): AgentProvider {
	return antigravityEnabled() ? normalizeAgentProvider(getOption('default_agent')) : 'claude';
}

/** Host directory Antigravity config/credential helpers read from; defaults to `~/.gemini/antigravity-cli`. */
export function hostAntigravityDir(): string {
	const custom = getOption('antigravity_config_dir')?.trim();
	return custom ? expandTilde(custom) : join(homedir(), '.gemini', 'antigravity-cli');
}

export const hostAntigravityFile = (...parts: string[]): string =>
	join(hostAntigravityDir(), ...parts);

export async function readHostAntigravitySettings(): Promise<Record<string, unknown> | null> {
	const file = hostAntigravityFile('settings.json');
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Sync twin for callers that can't await, e.g. MCP tool descriptors resolved per `tools/list`. */
export function readHostAntigravitySettingsSync(): Record<string, unknown> | null {
	const file = hostAntigravityFile('settings.json');
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}
