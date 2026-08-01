import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { mergeClaudeSettingsScript } from './attention-hooks.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/**
 * Both schemas on purpose: newer `claude` reads the nested `attribution` object, older builds
 * the root-level `includeCoAuthoredBy` — setting both suppresses the byline across versions.
 * Empty `commit`/`pr` strings drop the commit trailer and PR footer.
 */
export const NO_COAUTHOR_SETTINGS = {
	includeCoAuthoredBy: false,
	attribution: { commit: '', pr: '', includeCoAuthoredBy: false }
};

async function injectNoCoauthor(target: ContainerTarget): Promise<{ ok: boolean; error?: string }> {
	const res = await execInContainer(target, {
		script: mergeClaudeSettingsScript(),
		stdin: JSON.stringify(NO_COAUTHOR_SETTINGS)
	});
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** A Codebay-wide default rather than an opt-in setting, hence no `auth` block. */
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
