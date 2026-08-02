import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeContainerFile } from '../lib/container-files.server.ts';
import {
	claudeConfigFile,
	mergeClaudeSettings,
	readClaudeSettings
} from '../lib/claude-settings.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Left unexpanded — Claude Code invokes this long after the injection has finished. */
const CONTAINER_SCRIPT_PATH = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.sh';

interface StatusLineConfig {
	statusLine: Record<string, unknown>;
	/** Only set when `command` references a script file. */
	script?: string;
}

export async function readHostClaudeSettings(): Promise<Record<string, unknown> | null> {
	const file = join(homedir(), '.claude', 'settings.json');
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export const expandTilde = (p: string): string =>
	p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;

/** Only a real file counts — else jq's `//` operator and a bare `/` resolve to the root dir. */
const isExistingFile = (p: string): boolean => {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
};

/** A heuristic: a statusLine command is either a script path or an inline snippet with no file. */
export function extractScriptPath(command: string): string | null {
	const token = command
		.split(/\s+/)
		.find((t) => (t.startsWith('/') || t.startsWith('~/')) && isExistingFile(expandTilde(t)));
	return token ?? null;
}

/** A referenced script is read and its command rewritten, since the host path won't exist inside. */
export async function readStatusLineConfig(): Promise<StatusLineConfig | null> {
	const settings = await readHostClaudeSettings();
	const statusLine = settings?.statusLine as { type?: string; command?: string } | undefined;
	if (!statusLine || statusLine.type !== 'command' || !statusLine.command) return null;

	const token = extractScriptPath(statusLine.command);
	if (!token) return { statusLine };

	let script: string;
	try {
		script = await readFile(expandTilde(token), 'utf8');
	} catch {
		// A false-positive match must not disable the feature — inject the command verbatim.
		return { statusLine };
	}
	const command = statusLine.command.replaceAll(token, CONTAINER_SCRIPT_PATH);
	return { statusLine: { ...statusLine, command }, script };
}

/** A referenced script is staged first, then the statusLine block is merged into settings.json. */
async function injectStatusLine(
	target: ContainerTarget,
	config: StatusLineConfig
): Promise<{ ok: boolean; error?: string }> {
	if (config.script) {
		const wrote = await writeContainerFile(
			target,
			claudeConfigFile('statusline.sh', '755'),
			config.script
		);
		if (!wrote.ok) return wrote;
	}
	return mergeClaudeSettings(target, { statusLine: config.statusLine });
}

export const claudeStatusline: Injection = {
	id: 'claude-statusline',
	label: 'statusLine',

	auth: {
		hint: 'configure `statusLine` in ~/.claude/settings.json',
		async status() {
			const config = await readStatusLineConfig();
			return {
				available: config !== null,
				source: config ? '~/.claude/settings.json' : null
			};
		}
	},

	async apply(target, log) {
		const config = await readStatusLineConfig();
		if (!config) {
			log('⚠ No statusLine configured on host; skipped\n');
			return;
		}
		log('Injecting Claude Code statusLine…\n');
		const result = await injectStatusLine(target, config);
		log(
			result.ok
				? '✓ statusLine installed in container\n'
				: `⚠ statusLine injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		const settings = await readClaudeSettings(target);
		return !!settings?.statusLine;
	}
};
