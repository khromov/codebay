import { PORT } from '../lib/config.server.ts';
import { writeContainerFile } from '../lib/container-files.server.ts';
import {
	antigravityConfigFile,
	mergeAntigravityHooks,
	readAntigravityHooks
} from '../lib/antigravity-settings.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

function bridgeUrl(): string {
	return `http://host.docker.internal:${PORT}/api/bridge/attention`;
}

/** Read by curl as `-H @<file>` so the bridge token never reaches argv, where `ps` would show it. */
const HEADER_FILE = '$HOME/.gemini/antigravity-cli/.bridge-header';

const HOOK_LOG = '$HOME/.gemini/antigravity-cli/.bridge-hook.log';

/**
 * Antigravity parses each hook's stdout as JSON (`{}` allows Stop/PreInvocation to proceed;
 * `PreToolUse` requires `{"decision":"allow"}` to delegate cleanly).
 */
function hookCommand(id: string, state: 'done' | 'waiting' | 'busy', stdoutJson: string): string {
	const url = `${bridgeUrl()}?id=${encodeURIComponent(id)}&state=${state}`;
	const ping =
		`log="${HOOK_LOG}"; ` +
		`http=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H @"${HEADER_FILE}" '${url}' 2>>"$log"); ` +
		`rc=$?; ` +
		`printf '[%s] state=${state} http=%s curl_exit=%s\\n' "$(date -Is 2>/dev/null || date)" "$http" "$rc" >> "$log" 2>/dev/null; ` +
		`t=$(tail -n 500 "$log" 2>/dev/null) && printf '%s\\n' "$t" > "$log" 2>/dev/null`;
	// PreInvocation runs before every model call and hooks block the agent loop, so `busy` must
	// never wait on the bridge; the fds are closed so agy isn't left reading the hook's stdout.
	const send = state === 'busy' ? `( ${ping} ) </dev/null >/dev/null 2>&1 & ` : `${ping}; `;
	return `${send}printf '%s\\n' '${stdoutJson}'; true`;
}

/**
 * Follows Antigravity's `hooks.json` schema: `Stop` and `PreInvocation` take a flat handler list,
 * while `PreToolUse` wraps handlers under `{ matcher, hooks }`.
 */
export function antigravityAttentionHooksConfig(id: string): Record<string, unknown> {
	return {
		'codebay-attention': {
			Stop: [
				{
					type: 'command',
					command: hookCommand(id, 'done', '{}'),
					timeout: 10
				}
			],
			PreInvocation: [
				{
					type: 'command',
					command: hookCommand(id, 'busy', '{}'),
					timeout: 10
				}
			],
			PreToolUse: [
				{
					matcher: 'ask_question|ask_permission',
					hooks: [
						{
							type: 'command',
							command: hookCommand(id, 'waiting', '{"decision":"allow"}'),
							timeout: 10
						}
					]
				}
			]
		}
	};
}

function writeBridgeHeader(
	target: ContainerTarget,
	token: string
): Promise<{ ok: boolean; error?: string }> {
	return writeContainerFile(
		target,
		antigravityConfigFile('.bridge-header', '600'),
		`X-Bridge-Token: ${token}\n`
	);
}

export function hasAntigravityAttentionHook(
	hooks: Record<string, unknown> | null,
	id: string
): boolean {
	if (hooks === null) return false;
	return JSON.stringify(hooks['codebay-attention'] ?? null).includes(
		`id=${encodeURIComponent(id)}&state=`
	);
}

export const antigravityAttentionHooks: Injection = {
	id: 'antigravity-attention-hooks',
	label: 'Antigravity hooks',

	async apply(target, log) {
		log('Injecting Antigravity attention hooks…\n');
		const header = await writeBridgeHeader(target, target.instance.bridge_token);
		if (!header.ok) {
			log(`⚠ Antigravity hook injection failed: ${header.error}\n`);
			return;
		}
		const hooks = await mergeAntigravityHooks(
			target,
			antigravityAttentionHooksConfig(target.instance.id)
		);
		log(
			hooks.ok
				? '✓ Antigravity attention hooks installed\n'
				: `⚠ Antigravity hook injection failed: ${hooks.error}\n`
		);
	},

	async check(target) {
		return hasAntigravityAttentionHook(await readAntigravityHooks(target), target.instance.id);
	}
};
