import { mergeClaudeSettings, readClaudeSettings } from '../lib/claude-settings.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Both schemas on purpose: newer `claude` reads the nested `attribution` object, older builds
 * the root-level `includeCoAuthoredBy` — setting both suppresses the byline across versions.
 * Empty `commit`/`pr` strings drop the commit trailer and PR footer.
 */
export const NO_COAUTHOR_SETTINGS = {
	includeCoAuthoredBy: false,
	attribution: { commit: '', pr: '', includeCoAuthoredBy: false }
};

/** A Codebay-wide default rather than an opt-in setting, hence no `auth` block. */
export const claudeNoCoauthor: Injection = {
	id: 'claude-no-coauthor',
	label: 'no co-author byline',

	async apply(target, log) {
		log('Disabling Claude co-author commit byline…\n');
		const result = await mergeClaudeSettings(target, NO_COAUTHOR_SETTINGS);
		log(
			result.ok
				? '✓ Claude co-author byline disabled\n'
				: `⚠ Claude co-author byline injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		const settings = await readClaudeSettings(target);
		return settings !== null && 'includeCoAuthoredBy' in settings;
	}
};
