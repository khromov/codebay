import { PORT } from '../lib/config.server.ts';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
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
function hookFor(id: string, state: 'done' | 'waiting' | 'busy') {
	const url = `${bridgeUrl()}?id=${encodeURIComponent(id)}&state=${state}`;
	const command =
		`log="${HOOK_LOG}"; ` +
		// The Content-Type is for Mochi's CSRF guard, which reads a bodiless POST as a form submit.
		`http=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H @"${HEADER_FILE}" '${url}' 2>>"$log"); ` +
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
export function attentionHookSettings(id: string): string {
	const settings = {
		hooks: {
			Stop: hookFor(id, 'done'),
			Notification: hookFor(id, 'waiting'),
			UserPromptSubmit: hookFor(id, 'busy')
		}
	};
	return JSON.stringify(settings, null, 2);
}

/** Stored as a whole header line so curl can consume the file directly with `-H @`. */
async function writeBridgeHeader(
	target: ContainerTarget,
	token: string
): Promise<{ ok: boolean; error?: string }> {
	const script =
		'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; mkdir -p "$d"; ' +
		'f="$d/.bridge-header"; printf \'X-Bridge-Token: %s\\n\' "$CODEBAY_STDIN" > "$f"; chmod 600 "$f"';
	const res = await execInContainer(target, { script, stdin: token });
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Merging rather than overwriting is what lets the settings.json injections compose in any order. */
export function mergeClaudeSettingsScript(): string {
	return (
		'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; mkdir -p "$d"; ' +
		'f="$d/settings.json"; new="$CODEBAY_STDIN"; ' +
		'if command -v jq >/dev/null 2>&1 && [ -s "$f" ] && ' +
		'merged=$(printf \'%s\' "$new" | jq -s \'.[0] * .[1]\' "$f" - 2>/dev/null); then ' +
		'printf \'%s\' "$merged" > "$f"; else printf \'%s\' "$new" > "$f"; fi; ' +
		'chmod 644 "$f"'
	);
}

async function injectClaudeHooks(
	target: ContainerTarget,
	settingsJson: string
): Promise<{ ok: boolean; error?: string }> {
	const res = await execInContainer(target, {
		script: mergeClaudeSettingsScript(),
		stdin: settingsJson
	});
	return res.ok ? { ok: true } : { ok: false, error: res.error };
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
		const settings = attentionHookSettings(target.instance.id);
		const hooks = await injectClaudeHooks(target, settings);
		log(
			hooks.ok
				? '✓ Claude attention hooks installed\n'
				: `⚠ Claude hook injection failed: ${hooks.error}\n`
		);
	},

	async check(target) {
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
				'[ -s "$d/settings.json" ] && grep -q "$1" "$d/settings.json" && echo 1 || echo 0',
			['attention-check', target.instance.id]
		);
	}
};
