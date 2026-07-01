import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_CODE_TOKEN } from '../lib/config.server.ts';
import { checkPresence, execInContainer, writeSecretFileScript } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function isValid(json: string): boolean {
  try {
    const data = JSON.parse(json) as { claudeAiOauth?: { accessToken?: string } };
    return Boolean(data.claudeAiOauth?.accessToken);
  } catch {
    return false;
  }
}

/**
 * Locate the host's Claude Code OAuth credentials, returning both the JSON string
 * and a human-readable description of where it came from, or null if absent.
 * macOS keeps them in the login Keychain; Linux/others use ~/.claude/.credentials.json.
 */
export async function locateClaudeCredentials(): Promise<{ creds: string; source: string } | null> {
  // An explicit token override wins over any host discovery.
  if (CLAUDE_CODE_TOKEN) {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: CLAUDE_CODE_TOKEN } });
    return { creds, source: 'DCM_CLAUDE_CODE_TOKEN env var' };
  }

  if (process.platform === 'darwin') {
    const out = await spawnCapture([
      'security',
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    if (out && isValid(out)) {
      return { creds: out, source: `macOS Keychain — "${KEYCHAIN_SERVICE}"` };
    }
  }

  const file = join(homedir(), '.claude', '.credentials.json');
  if (existsSync(file)) {
    const raw = (await readFile(file, 'utf8')).trim();
    if (isValid(raw)) return { creds: raw, source: '~/.claude/.credentials.json' };
  }
  return null;
}

/**
 * Authorize Claude Code inside a running container as its remote user. Writes the
 * credentials (via a scrubbed shell variable, never argv) plus a `hasCompletedOnboarding` flag — the
 * latter is what stops `claude` re-running its first-run setup/login wizard.
 *
 * Both paths honor the container's CLAUDE_CONFIG_DIR: credentials at
 * $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude/.credentials.json) and
 * config at $CLAUDE_CONFIG_DIR/.claude.json (default ~/.claude.json).
 */
async function injectClaudeCredentials(
  target: ContainerTarget,
  creds: string,
): Promise<{ ok: boolean; error?: string }> {
  const script =
    'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
    writeSecretFileScript('$d', '.credentials.json', '600') +
    ' cfg="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"; cfg="${cfg:-$h/.claude.json}"; ' +
    'printf \'%s\' \'{"hasCompletedOnboarding":true}\' > "$cfg"; chmod 644 "$cfg"';
  const res = await execInContainer(target, { script, stdin: creds });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Inject the host's Claude Code OAuth credentials so the in-container `claude` is
 * authorized without a fresh login. Containers are throwaway, so we copy auth into
 * each one. Skipped (with a log line) when the host has no credentials.
 */
export const claudeCodeCredentials: Injection = {
  id: 'claude-code-credentials',
  label: 'Claude Code',

  auth: {
    hint: 'run `claude` and sign in',
    async status() {
      const found = await locateClaudeCredentials();
      return { available: found !== null, source: found?.source ?? null };
    },
  },

  async apply(target, log) {
    const found = await locateClaudeCredentials();
    if (!found) {
      log('⚠ No Claude Code credentials found on host; skipped auth injection\n');
      return;
    }
    log('Injecting Claude Code credentials…\n');
    const injected = await injectClaudeCredentials(target, found.creds);
    log(
      injected.ok
        ? '✓ Claude Code authorized in container\n'
        : `⚠ Claude auth injection failed: ${injected.error}\n`,
    );
  },

  async check(target) {
    return checkPresence(
      target,
      'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; ' +
        '[ -s "$d/.credentials.json" ] && echo 1 || echo 0',
    );
  },
};
