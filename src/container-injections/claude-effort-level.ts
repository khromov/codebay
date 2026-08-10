import { getOption } from '../lib/db.server.ts';
import { mergeClaudeSettings, readClaudeSettings } from '../lib/claude-settings.server.ts';
import { normalizeEffortLevel } from '../types.ts';
import type { ClaudeEffortLevel } from '../types.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Also read by the settings-page `serverProps` to seed the UI. */
export function getClaudeEffortLevel(): ClaudeEffortLevel {
	return normalizeEffortLevel(getOption('claude_effort_level'));
}

/** Writes Claude Code's `effortLevel` default into the container so new sessions start at the chosen effort. */
export const claudeEffortLevel: Injection = {
	id: 'claude-effort-level',
	label: 'effort level',

	async apply(target, log) {
		const level = getClaudeEffortLevel();
		log(`Setting Claude effort level (${level})…\n`);
		const result = await mergeClaudeSettings(target, { effortLevel: level });
		log(
			result.ok
				? '✓ Claude effort level configured in container\n'
				: `⚠ Claude effort level injection failed: ${result.error}\n`
		);
	},

	async check(target) {
		const settings = await readClaudeSettings(target);
		return settings?.effortLevel === getClaudeEffortLevel();
	}
};
