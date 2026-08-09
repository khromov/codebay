import { PORT } from '../lib/config.server.ts';
import { writeContainerFile } from '../lib/container-files.server.ts';
import {
	claudeConfigFile,
	mergeClaudeSettings,
	readClaudeSettings
} from '../lib/claude-settings.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

function bridgeUrl(): string {
	return `http://host.docker.internal:${PORT}/api/bridge/attention`;
}

/** Read by curl as `-H @<file>` so the token never reaches argv, where `ps` would show it. */
const HEADER_FILE = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.bridge-header';

/** Claude discards hook stdout/stderr, so a silently-failing ping would leave no other trace. */
const HOOK_LOG = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.bridge-hook.log';

/**
 * `-f` is deliberately absent so a 4xx still yields an HTTP status to log rather than
 * curl bailing early; `curl_exit` then separates "unreachable" from "answered with a status".
 */
function hookFor(id: string, state: 'done' | 'waiting' | 'busy', forwardStdin = false) {
	const url = `${bridgeUrl()}?id=${encodeURIComponent(id)}&state=${state}`;
	// UserPromptSubmit pipes its stdin (the hook JSON) through so the bridge can read the
	// prompt; other hooks send no body. `@-` reads stdin, which Claude always supplies here.
	const body = forwardStdin ? '--data-binary @- ' : '';
	const command =
		`log="${HOOK_LOG}"; ` +
		// The Content-Type is for Mochi's CSRF guard, which reads a bodiless POST as a form submit.
		`http=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST ${body}-H 'Content-Type: application/json' -H @"${HEADER_FILE}" '${url}' 2>>"$log"); ` +
		`rc=$?; ` +
		`printf '[%s] state=${state} http=%s curl_exit=%s\\n' "$(date -Is 2>/dev/null || date)" "$http" "$rc" >> "$log" 2>/dev/null; ` +
		// Keep the log bounded without a race window that could lose the file.
		`t=$(tail -n 500 "$log" 2>/dev/null) && printf '%s\\n' "$t" > "$log" 2>/dev/null; ` +
		`true`;
	return [
		{
			hooks: [
				{
					type: 'command',
					command
				}
			]
		}
	];
}

/** Carries no token — that lives in the mode-600 header file `writeBridgeHeader` stages. */
export function attentionHookSettings(id: string): Record<string, unknown> {
	return {
		hooks: {
			Stop: hookFor(id, 'done'),
			Notification: hookFor(id, 'waiting'),
			UserPromptSubmit: hookFor(id, 'busy', true)
		}
	};
}

/** Stored as a whole header line so curl can consume the file directly with `-H @`. */
function writeBridgeHeader(
	target: ContainerTarget,
	token: string
): Promise<{ ok: boolean; error?: string }> {
	return writeContainerFile(
		target,
		claudeConfigFile('.bridge-header', '600'),
		`X-Bridge-Token: ${token}\n`
	);
}

/** Matches the delimited `id=<id>&state=` fragment of the hook's curl URL, so no other instance id can match by substring. */
export function hasAttentionHook(settings: Record<string, unknown> | null, id: string): boolean {
	if (settings === null) return false;
	return JSON.stringify(settings.hooks ?? null).includes(`id=${encodeURIComponent(id)}&state=`);
}

export const attentionHooks: Injection = {
	id: 'attention-hooks',
	label: 'Claude hooks',

	async apply(target, log) {
		log('Injecting Claude attention hooks…\n');
		const header = await writeBridgeHeader(target, target.instance.bridge_token);
		if (!header.ok) {
			log(`⚠ Claude hook injection failed: ${header.error}\n`);
			return;
		}
		const hooks = await mergeClaudeSettings(target, attentionHookSettings(target.instance.id));
		log(
			hooks.ok
				? '✓ Claude attention hooks installed\n'
				: `⚠ Claude hook injection failed: ${hooks.error}\n`
		);
	},

	async check(target) {
		return hasAttentionHook(await readClaudeSettings(target), target.instance.id);
	}
};
