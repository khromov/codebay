import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { mergeClaudeSettingsScript } from './attention-hooks.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/**
 * Merge `includeCoAuthoredBy: false` into the container's Claude config dir.
 * Reuses the shared jq-merge-with-fallback script (see `attention-hooks.ts`),
 * so this composes with whatever else has already written to settings.json
 * regardless of apply order.
 */
async function injectNoCoauthor(target: ContainerTarget): Promise<{ ok: boolean; error?: string }> {
	const res = await execInContainer(target, {
		script: mergeClaudeSettingsScript(),
		stdin: JSON.stringify({ includeCoAuthoredBy: false })
	});
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Turn off Claude Code's `Co-Authored-By: Claude` commit trailer and
 * "Generated with Claude Code" line, so commits made from a container look
 * like the user's own work. Always applied; it has no host dependency — this
 * is a Codebay-wide default, not an opt-in setting.
 */
export const claudeNoCoauthor: Injection = {
	id: 'claude-no-coauthor',
	label: 'no co-author byline',

	async apply(target, log) {
		log('Disabling Claude co-author commit byline…\n');
		const result = await injectNoCoauthor(target);
		log(
			result.ok
				? '✓ Claude co-author byline disabled\n'
				: `⚠ Claude co-author byline injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		return checkPresence(
			target,
			'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
				'[ -s "$d/settings.json" ] && grep -q includeCoAuthoredBy "$d/settings.json" && echo 1 || echo 0'
		);
	}
};
