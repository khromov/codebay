/**
 * Debug helper: print the Claude Code and GitHub CLI credentials the manager
 * would inject into a container, and where it found them. Reuses the exact
 * host-discovery functions the injections use, so this never drifts from the app.
 *
 *   bun run debug:tokens          # masked tokens (safe to paste in an issue)
 *   bun run debug:tokens --full   # reveal full tokens (be careful)
 */
import { locateClaudeCredentials } from '../src/container-injections/claude-code-credentials.ts';
import { readGhToken } from '../src/container-injections/github-credentials.ts';

const FULL = process.argv.includes('--full');

/** Mask a secret to a short, paste-safe preview unless --full was passed. */
function show(secret: string): string {
	if (FULL) return secret;
	if (secret.length <= 12) return '*'.repeat(secret.length);
	return `${secret.slice(0, 6)}…${secret.slice(-4)} (${secret.length} chars)`;
}

function report(label: string, token: string | null, source: string | null) {
	console.log(`\n${label}`);
	if (!token) {
		console.log('  ✗ not found on host');
		return;
	}
	console.log(`  ✓ source: ${source}`);
	console.log(`  token:  ${show(token)}`);
}

const [claude, gh] = await Promise.all([locateClaudeCredentials(), readGhToken()]);

// locateClaudeCredentials returns the full credentials JSON; pull out the OAuth token.
const claudeToken = claude
	? ((JSON.parse(claude.creds) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth
			?.accessToken ?? null)
	: null;

report('Claude Code', claudeToken, claude?.source ?? null);
report('GitHub CLI', gh?.token ?? null, gh?.source ?? null);
if (!FULL) console.log('\n(tokens masked — pass --full to reveal)');
