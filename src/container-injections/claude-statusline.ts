import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { mergeClaudeSettingsScript } from './attention-hooks.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Left unexpanded — Claude Code invokes this long after the injection has finished. */
const CONTAINER_SCRIPT_PATH = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.sh';

interface StatusLineConfig {
	statusLine: Record<string, unknown>;
	/** Only set when `command` references a script file. */
	script?: string;
}

async function readHostClaudeSettings(): Promise<Record<string, unknown> | null> {
	const file = join(homedir(), '.claude', 'settings.json');
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** A heuristic: a statusLine command is either a script path or a package runner with no file. */
export function extractScriptPath(command: string): string | null {
	const token = command.split(/\s+/).find((t) => t.startsWith('/') && existsSync(t));
	return token ?? null;
}

/** A referenced script is read and its command rewritten, since the host path won't exist inside. */
export async function readStatusLineConfig(): Promise<StatusLineConfig | null> {
	const settings = await readHostClaudeSettings();
	const statusLine = settings?.statusLine as { type?: string; command?: string } | undefined;
	if (!statusLine || statusLine.type !== 'command' || !statusLine.command) return null;

	const hostPath = extractScriptPath(statusLine.command);
	if (!hostPath) return { statusLine };

	let script: string;
	try {
		script = await readFile(hostPath, 'utf8');
	} catch {
		return null;
	}
	const command = statusLine.command.replaceAll(hostPath, CONTAINER_SCRIPT_PATH);
	return { statusLine: { ...statusLine, command }, script };
}

/** Two execs rather than one, because `execInContainer` carries a single `stdin` payload per call. */
async function injectStatusLine(
	target: ContainerTarget,
	config: StatusLineConfig
): Promise<{ ok: boolean; error?: string }> {
	if (config.script) {
		const writeScript =
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; mkdir -p "$d"; ' +
			'printf \'%s\' "$CODEBAY_STDIN" > "$d/statusline.sh"; chmod 755 "$d/statusline.sh"';
		const res = await execInContainer(target, { script: writeScript, stdin: config.script });
		if (!res.ok) return { ok: false, error: res.error };
	}
	const res = await execInContainer(target, {
		script: mergeClaudeSettingsScript(),
		stdin: JSON.stringify({ statusLine: config.statusLine })
	});
	return res.ok ? { ok: true } : { ok: false, error: res.error };
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
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
				'[ -s "$d/settings.json" ] && grep -q statusLine "$d/settings.json" && echo 1 || echo 0'
		);
	}
};
