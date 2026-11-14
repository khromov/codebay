import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getOption } from './db.server.ts';

/** Expands a leading `~` to the host home; other paths pass through untouched. */
export const expandTilde = (p: string): string =>
	p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;

/**
 * Host directory the Claude config injections read from: the `claude_config_dir` setting when set,
 * else `~/.claude`. One resolver so credentials, statusline, output styles, and skills never diverge.
 */
export function hostClaudeDir(): string {
	const custom = getOption('claude_config_dir')?.trim();
	return custom ? expandTilde(custom) : join(homedir(), '.claude');
}

/** A path under the configured host Claude dir, e.g. `hostClaudeFile('CLAUDE.md')`. */
export const hostClaudeFile = (...parts: string[]): string => join(hostClaudeDir(), ...parts);

export async function readHostClaudeSettings(): Promise<Record<string, unknown> | null> {
	const file = hostClaudeFile('settings.json');
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}
