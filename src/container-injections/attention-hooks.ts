import { PORT } from '../lib/config.server.ts';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** Bridge URL a container reaches the manager on (Colima/Docker host-gateway). */
function bridgeUrl(): string {
	return `http://host.docker.internal:${PORT}/api/bridge/attention`;
}

/** Where each container keeps its bridge-auth header, resolved at hook runtime. */
const HEADER_FILE = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.bridge-header';

/** Debug log every hook appends its outcome to, inside the container's Claude
 * config dir. Tail it from a terminal in the container to see whether each
 * notification actually left and how the bridge answered:
 *   tail -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.bridge-hook.log"
 * Slowly-growing (one line per Stop/Notification/UserPromptSubmit); the hook
 * trims it back to the last 500 lines on each write. */
const HOOK_LOG = '${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.bridge-hook.log';

/**
 * One `type: command` hook firing curl at the bridge with the given state. The
 * token rides in a header (`X-Bridge-Token`), not the query string, so it doesn't
 * end up in server request logs — and the header is read from a mode-600 file
 * (`curl -H @<file>`) rather than interpolated onto curl's argv, so it isn't
 * visible via `ps` inside the container. `id`/`state` aren't secret, so they stay
 * in the query string.
 *
 * The curl outcome is recorded to `HOOK_LOG` for debugging: the hook's own
 * stdout/stderr is otherwise discarded by Claude, so a silently-failing
 * notification (DNS, timeout, wrong port, rejected token) leaves no other trace.
 * `-f` is dropped versus a bare fire-and-forget so we still capture the HTTP
 * status on a 4xx (e.g. a 403 token mismatch) rather than curl bailing early;
 * `curl_exit` distinguishes "couldn't reach the server" (non-zero) from "reached
 * it, got an HTTP status" (zero, read `http`).
 */
function hookFor(id: string, state: 'done' | 'waiting' | 'busy') {
	const url = `${bridgeUrl()}?id=${encodeURIComponent(id)}&state=${state}`;
	const command =
		`log="${HOOK_LOG}"; ` +
		`http=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST -H @"${HEADER_FILE}" '${url}' 2>>"$log"); ` +
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

/**
 * The Claude `settings.json` (as a JSON string) injected into a container so its
 * Claude reports task completion / waiting back to the manager. `Stop` → green,
 * `Notification` (needs input/permission) → amber, `UserPromptSubmit` (resumed) → clear.
 * The bridge token is NOT in here — it lives in a separate mode-600 header file the
 * hooks read at runtime (see `writeBridgeHeader`).
 */
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

/**
 * Stage the per-instance bridge token into a mode-600 `.bridge-header` file (as a
 * full `X-Bridge-Token: <token>` header line) inside the container's Claude config
 * dir. The token travels via the scrubbed `$CODEBAY_STDIN` exec var, never on argv.
 */
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

/**
 * Merge the attention hooks into a running container's Claude config dir. Passes the
 * JSON via a scrubbed shell variable (never argv) and deep-merges it into any existing
 * `$CLAUDE_CONFIG_DIR/settings.json` (default ~/.claude/settings.json) with `jq`, so
 * a config the image already ships (e.g. a `statusLine`) is preserved — our hooks win
 * only on key conflicts. Falls back to writing our JSON outright when there's no
 * existing file, no `jq`, or the existing file isn't valid JSON.
 */
async function injectClaudeHooks(
	target: ContainerTarget,
	settingsJson: string
): Promise<{ ok: boolean; error?: string }> {
	const script =
		'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; mkdir -p "$d"; ' +
		'f="$d/settings.json"; new="$CODEBAY_STDIN"; ' +
		'if command -v jq >/dev/null 2>&1 && [ -s "$f" ] && ' +
		'merged=$(printf \'%s\' "$new" | jq -s \'.[0] * .[1]\' "$f" - 2>/dev/null); then ' +
		'printf \'%s\' "$merged" > "$f"; else printf \'%s\' "$new" > "$f"; fi; ' +
		'chmod 644 "$f"';
	const res = await execInContainer(target, { script, stdin: settingsJson });
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Install the Claude attention hooks so the in-container Claude pings the manager
 * when it finishes a task or needs input, pulsing this instance's IDE tab. Always
 * applied — it has no host dependency, only the instance id + bridge token.
 */
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
		// Hooks are present when settings.json exists and mentions this instance id.
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
				'[ -s "$d/settings.json" ] && grep -q "$1" "$d/settings.json" && echo 1 || echo 0',
			['attention-check', target.instance.id]
		);
	}
};
