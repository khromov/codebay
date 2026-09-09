import { parse, stringify } from 'smol-toml';
import { PORT } from '../lib/config.server.ts';
import { readContainerFileResult, writeContainerFile } from '../lib/container-files.server.ts';
import { codexConfigFile } from '../lib/codex-settings.server.ts';
import { checkPresence } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

const SCRIPT = '/opt/codebay/codex-attention.sh';
const REQUIREMENTS = { dir: '/etc/codex', name: 'requirements.toml', mode: '644' };

export function managedCodexHooks(): Record<
	string,
	{ matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]
> {
	return Object.fromEntries(
		[
			['Stop', 'done', undefined],
			['PermissionRequest', 'waiting', undefined],
			['UserPromptSubmit', 'busy', undefined],
			['PreToolUse', 'waiting', '^request_user_input$'],
			['PostToolUse', 'busy', undefined]
		].map(([event, state, matcher]) => [
			event,
			[
				{
					...(matcher ? { matcher } : {}),
					hooks: [{ type: 'command', command: `${SCRIPT} ${state}`, timeout: 6 }]
				}
			]
		])
	);
}

export const codexAttentionHooks: Injection = {
	id: 'codex-attention-hooks',
	label: 'Codex attention notifications',
	async apply(target, log) {
		const header = await writeContainerFile(
			target,
			codexConfigFile('.bridge-header'),
			`X-Bridge-Token: ${target.instance.bridge_token}\n`
		);
		if (!header.ok) throw new Error(header.error);
		const script = `#!/bin/sh
case "$1" in done|waiting|busy) ;; *) exit 0 ;; esac
d="\${CODEX_HOME:-$HOME/.codex}"
curl -sS -m 5 -o /dev/null -X POST -H 'Content-Type: application/json' -H @"$d/.bridge-header" "http://host.docker.internal:${PORT}/api/bridge/attention?id=${target.instance.id}&agent=codex&state=$1" 2>>"$d/.bridge-hook.log"
exit 0
`;
		const root = { containerId: target.containerId };
		const written = await writeContainerFile(
			root,
			{ dir: '/opt/codebay', name: 'codex-attention.sh', mode: '755' },
			script
		);
		if (!written.ok) throw new Error(written.error);
		const read = await readContainerFileResult(root, REQUIREMENTS);
		if (!read.ok) throw new Error(read.error);
		const config: Record<string, unknown> = read.content ? parse(read.content) : {};
		const hooks = (config.hooks ?? {}) as Record<string, unknown>;
		for (const [event, groups] of Object.entries(managedCodexHooks())) {
			const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
			hooks[event] = [
				...existing.filter((group) => !JSON.stringify(group).includes(SCRIPT)),
				...groups
			];
		}
		config.hooks = hooks;
		const result = await writeContainerFile(root, REQUIREMENTS, stringify(config));
		log(
			result.ok
				? '✓ Codex attention notifications installed\n'
				: `⚠ Codex hook injection failed: ${result.error}\n`
		);
	},
	check: (target) =>
		checkPresence(
			target,
			`test -x ${SCRIPT} && grep -q '${SCRIPT}' /etc/codex/requirements.toml && echo 1 || echo 0`
		)
};
