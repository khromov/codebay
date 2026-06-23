import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
 * Read the host's Claude Code OAuth credentials as a JSON string, or null if absent.
 * macOS keeps them in the login Keychain; Linux/others use ~/.claude/.credentials.json.
 */
export async function readClaudeCredentials(): Promise<string | null> {
  if (process.platform === 'darwin') {
    try {
      const proc = Bun.spawn(
        ['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
        { stdout: 'pipe', stderr: 'ignore' },
      );
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const trimmed = out.trim();
      if (code === 0 && trimmed && isValid(trimmed)) return trimmed;
    } catch {
      /* fall through to the file check */
    }
  }

  const file = join(homedir(), '.claude', '.credentials.json');
  if (existsSync(file)) {
    const raw = (await readFile(file, 'utf8')).trim();
    if (isValid(raw)) return raw;
  }
  return null;
}

/** Whether host Claude Code credentials are available to inject into containers. */
export async function claudeAuthAvailable(): Promise<boolean> {
  return (await readClaudeCredentials()) !== null;
}

/**
 * Authorize Claude Code inside a running container as its remote user. Writes the
 * credentials (via stdin, never argv) plus a `hasCompletedOnboarding` flag — the
 * latter is what stops `claude` re-running its first-run setup/login wizard.
 *
 * Both paths honor the container's CLAUDE_CONFIG_DIR: credentials at
 * $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude/.credentials.json) and
 * config at $CLAUDE_CONFIG_DIR/.claude.json (default ~/.claude.json).
 */
export async function injectClaudeCredentials(
  containerId: string,
  remoteUser: string | undefined,
  creds: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = remoteUser?.trim() || 'root';
  const script =
    'h=$(eval echo ~$(id -un)); d="${CLAUDE_CONFIG_DIR:-$h/.claude}"; mkdir -p "$d"; ' +
    'cat > "$d/.credentials.json"; chmod 600 "$d/.credentials.json"; ' +
    'cfg="${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}"; cfg="${cfg:-$h/.claude.json}"; ' +
    'printf \'%s\' \'{"hasCompletedOnboarding":true}\' > "$cfg"; chmod 644 "$cfg"';
  try {
    const proc = Bun.spawn(['docker', 'exec', '-i', '-u', user, containerId, 'bash', '-lc', script], {
      stdin: 'pipe',
      stdout: 'ignore',
      stderr: 'pipe',
    });
    proc.stdin.write(creds);
    await proc.stdin.end();
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    return code === 0 ? { ok: true } : { ok: false, error: err.trim() || `exit ${code}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
