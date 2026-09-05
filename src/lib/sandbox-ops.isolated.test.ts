import { afterEach, describe, expect, test } from 'bun:test';
import { setOption } from './db.server.ts';
import { PR_ATTRIBUTION, PR_ATTRIBUTION_KEY, withAttribution } from './sandbox-ops.server.ts';
import { AGENT_RUN_MARKER, launchClaude } from './devcontainer.server.ts';

afterEach(() => setOption(PR_ATTRIBUTION_KEY, '0'));

describe('pull-request attribution', () => {
	test('is off by default, so a PR body passes through untouched', () => {
		setOption(PR_ATTRIBUTION_KEY, '0');
		expect(withAttribution('Fixes the thing.')).toBe('Fixes the thing.');
	});

	test('appends the footer once enabled', () => {
		setOption(PR_ATTRIBUTION_KEY, '1');
		const body = withAttribution('Fixes the thing.');
		expect(body).toContain('Fixes the thing.');
		expect(body).toContain(PR_ATTRIBUTION);
		expect(body).toContain('\n---\n');
	});

	test('does not double up when the caller already wrote the footer', () => {
		setOption(PR_ATTRIBUTION_KEY, '1');
		const once = withAttribution('Body.');
		expect(withAttribution(once)).toBe(once);
	});

	test('handles an empty body', () => {
		setOption(PR_ATTRIBUTION_KEY, '1');
		expect(withAttribution('').trim().startsWith('---')).toBe(true);
	});
});

describe('the shared Claude auto-launch fragment', () => {
	// Spliced into both the IDE folderOpen task and the ttyd launcher, so guarding it here covers
	// every path that would otherwise start a second Claude beside a running agent.
	const script = launchClaude('default');

	test('checks the agent-run marker before launching anything', () => {
		expect(script).toContain(AGENT_RUN_MARKER);
		// The guard has to come first, or it would launch and then notice.
		expect(script.indexOf(AGENT_RUN_MARKER)).toBeLessThan(script.indexOf('claude '));
	});

	test('still launches Claude on the else branch', () => {
		expect(script).toContain('claude --dangerously-skip-permissions');
		expect(script).toContain('else');
	});

	test('carries no single quotes — it is spliced into single-quoted tmux commands', () => {
		expect(script).not.toContain("'");
	});
});
