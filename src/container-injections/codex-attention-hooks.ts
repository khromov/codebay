import { checkPresence, execInContainer, writeSecretFileScript } from '../lib/exec.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

const MANAGED_COMMAND_MARKER = '.codebay-attention-hook';

/** Bridge URL a container reaches the manager on (Colima/Docker host-gateway). */
function bridgeUrl(): string {
	const port = Number(process.env.PORT) || 3333;
	return `http://host.docker.internal:${port}/api/bridge/attention`;
}

type HookHandler = { type: 'command'; command: string; timeout: number };
type HookGroup = { hooks: HookHandler[]; [key: string]: unknown };
type HooksFile = {
	description?: string;
	hooks?: Record<string, unknown[]>;
	[key: string]: unknown;
};

function managedGroup(state: 'done' | 'waiting' | 'busy', id: string): HookGroup {
	return {
		hooks: [
			{
				type: 'command',
				command: `"${'${CODEX_HOME:-$HOME/.codex}'}/${MANAGED_COMMAND_MARKER}" ${state} ${id}`,
				timeout: 10
			}
		]
	};
}

function isManaged(group: unknown): boolean {
	if (!group || typeof group !== 'object') return false;
	const handlers = (group as { hooks?: unknown }).hooks;
	return (
		Array.isArray(handlers) &&
		handlers.some(
			(hook) =>
				hook !== null &&
				typeof hook === 'object' &&
				typeof (hook as { command?: unknown }).command === 'string' &&
				(hook as { command: string }).command.includes(MANAGED_COMMAND_MARKER)
		)
	);
}

/**
 * Replace only Codebay-owned hook groups while retaining every unrelated hook
 * and top-level field from an existing user hooks.json.
 */
export function mergeCodexHooks(raw: string, id: string): string {
	const parsed = (raw.trim() ? JSON.parse(raw) : {}) as HooksFile;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('existing Codex hooks.json is not a JSON object');
	}
	const hooks =
		parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
			? { ...parsed.hooks }
			: {};
	for (const [event, state] of [
		['Stop', 'done'],
		['PermissionRequest', 'waiting'],
		['UserPromptSubmit', 'busy']
	] as const) {
		const existing: unknown[] = Array.isArray(hooks[event]) ? hooks[event] : [];
		hooks[event] = [...existing.filter((group) => !isManaged(group)), managedGroup(state, id)];
	}
	return JSON.stringify({ ...parsed, hooks }, null, 2);
}

function hookScript(): string {
	return `#!/bin/sh
state="$1"
instance_id="$2"
d="\${CODEX_HOME:-$HOME/.codex}"
log="$d/.bridge-hook.log"
url="${bridgeUrl()}?id=$instance_id&state=$state"
http=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -X POST -H @"$d/.bridge-header" "$url" 2>>"$log")
rc=$?
printf '[%s] state=%s http=%s curl_exit=%s\\n' "$(date -Is 2>/dev/null || date)" "$state" "$http" "$rc" >> "$log" 2>/dev/null
t=$(tail -n 500 "$log" 2>/dev/null) && printf '%s\\n' "$t" > "$log" 2>/dev/null
exit 0
`;
}

async function codexHomeFile(
	target: ContainerTarget,
	filename: string,
	content: string,
	mode: string
): Promise<{ ok: boolean; error?: string }> {
	const script =
		'h=$(eval echo ~$(id -un)); d="${CODEX_HOME:-$h/.codex}"; ' +
		writeSecretFileScript('$d', filename, mode);
	const result = await execInContainer(target, { script, stdin: content });
	return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function readHooks(target: ContainerTarget): Promise<string> {
	const result = await execInContainer(target, {
		script:
			'h=$(eval echo ~$(id -un)); f="${CODEX_HOME:-$h/.codex}/hooks.json"; ' +
			'if [ -s "$f" ]; then cat "$f"; else printf \'{}\'; fi',
		capture: true
	});
	if (!result.ok) throw new Error(result.error || 'could not read Codex hooks.json');
	return result.stdout;
}

export const codexAttentionHooks: Injection = {
	id: 'codex-attention-hooks',
	label: 'Codex hooks',

	async apply(target, log) {
		log('Injecting Codex attention hooks…\n');
		const header = await codexHomeFile(
			target,
			'.bridge-header',
			`X-Bridge-Token: ${target.instance.bridge_token}\n`,
			'600'
		);
		if (!header.ok) {
			log(`⚠ Codex hook injection failed: ${header.error}\n`);
			return;
		}
		const script = await codexHomeFile(target, MANAGED_COMMAND_MARKER, hookScript(), '700');
		if (!script.ok) {
			log(`⚠ Codex hook injection failed: ${script.error}\n`);
			return;
		}
		try {
			const hooks = mergeCodexHooks(await readHooks(target), target.instance.id);
			const written = await codexHomeFile(target, 'hooks.json', hooks, '600');
			log(
				written.ok
					? '✓ Codex attention hooks installed\n'
					: `⚠ Codex hook injection failed: ${written.error}\n`
			);
		} catch (error) {
			log(`⚠ Codex hook injection failed: ${(error as Error).message}\n`);
		}
	},

	async check(target) {
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CODEX_HOME:-$h/.codex}"; ' +
				'[ -s "$d/hooks.json" ] && [ -x "$d/.codebay-attention-hook" ] && ' +
				'grep -q "$1" "$d/hooks.json" && echo 1 || echo 0',
			['codex-attention-check', target.instance.id]
		);
	}
};
