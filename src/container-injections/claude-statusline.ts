import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { mergeClaudeSettingsScript } from './attention-hooks.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/**
 * Where a copied-in statusLine script lands inside the container. Embedded
 * directly into the rewritten `command` (like `attention-hooks.ts`'s
 * `HEADER_FILE`/`HOOK_LOG`), so the shell that later runs the command expands it
 * — not resolved at injection time, since the value is baked into JSON text that
 * Claude Code will invoke long after this injection has finished.
 */
const CONTAINER_SCRIPT_PATH = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.sh';

interface StatusLineConfig {
	/** The `statusLine` block to merge into the container's settings.json. */
	statusLine: Record<string, unknown>;
	/** Host script content to copy in, when `command` references a script file. */
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

/**
 * The first absolute-path token in `command` that exists as a file on this host,
 * or null. Heuristic: statusLine commands are usually either a bare script path
 * (`/path/to/statusline.sh`) or a bare package runner (`npx ccstatusline@latest`)
 * with no file dependency at all — this only needs to catch the former.
 */
export function extractScriptPath(command: string): string | null {
	const token = command.split(/\s+/).find((t) => t.startsWith('/') && existsSync(t));
	return token ?? null;
}

/**
 * Read the host's `statusLine` config from `~/.claude/settings.json`, ready to
 * inject. Returns null when the host has none configured, it isn't a `command`
 * type, or (when the command references a script file) that file can't be read.
 * When the command points at a script, its content is read so `apply()` can copy
 * it in and the command is rewritten to the in-container path — the host's
 * absolute path obviously won't exist inside the container. A bare command with
 * no file reference (e.g. an `npx` runner) is forwarded verbatim.
 */
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

/**
 * Copy the statusLine script into the container (when there is one) and merge the
 * `statusLine` block into the container's settings.json — two separate execs since
 * `execInContainer` carries only one `stdin` payload per call. The script travels
 * via the scrubbed `$CODEBAY_STDIN` var (never argv); the JSON merge reuses the
 * same jq-merge-with-fallback script the attention hooks use, so this composes
 * with whatever else has already written to settings.json regardless of apply
 * order.
 */
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

/**
 * Copy the host's Claude Code `statusLine` config (and its script, if the command
 * references one) into every new container, so the in-container `claude` shows
 * the same status line as the host. Skipped (with a log line) when the host has
 * none configured.
 */
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
