import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_TOKEN } from '../lib/config.server.ts';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

const GH_HOST = 'github.com';

/** The host's GitHub CLI auth, ready to stage inside a container. */
interface GhCredentials {
  token: string;
  /** GitHub login, when cheaply readable from the host's hosts.yml. */
  user?: string;
  /** Preferred git protocol (`https`/`ssh`), defaults to https when unknown. */
  gitProtocol?: string;
}

/**
 * Resolve the GitHub token to inject, plus a human-readable source for display.
 * An explicit `DCM_GITHUB_TOKEN` override wins; otherwise read it via the `gh`
 * binary, which transparently spans its storage backends (macOS Keychain,
 * encrypted file, or GH_TOKEN). Returns null when no token is available.
 */
export async function readGhToken(): Promise<{ token: string; source: string } | null> {
  if (GITHUB_TOKEN) return { token: GITHUB_TOKEN, source: 'DCM_GITHUB_TOKEN env var' };
  const token = await spawnCapture(['gh', 'auth', 'token', '--hostname', GH_HOST]);
  return token ? { token, source: `GitHub CLI — ${GH_HOST}` } : null;
}

/**
 * Best-effort read of `user`/`git_protocol` from the host's gh config so we can
 * populate them in the container's hosts.yml. The token lives in the keychain,
 * not this file, so a lightweight line parse is enough — no YAML dependency.
 */
async function readGhHostMeta(): Promise<{ user?: string; gitProtocol?: string }> {
  const file = join(homedir(), '.config', 'gh', 'hosts.yml');
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const user = raw.match(/^\s+user:\s*(\S+)/m)?.[1];
    const gitProtocol = raw.match(/^\s+git_protocol:\s*(\S+)/m)?.[1];
    return { user, gitProtocol };
  } catch {
    return {};
  }
}

/** Read the GitHub CLI credentials for injection, or null if absent. */
async function readGhCredentials(): Promise<GhCredentials | null> {
  const found = await readGhToken();
  if (!found) return null;
  const { user, gitProtocol } = await readGhHostMeta();
  return { token: found.token, user, gitProtocol };
}

/**
 * Authorize the GitHub CLI inside a running container as its remote user. Writes
 * `~/.config/gh/hosts.yml` (token via a scrubbed shell variable, never argv) so `gh` is signed in,
 * then runs `gh auth setup-git` when the binary exists so `git push`/`pull` over
 * HTTPS is authenticated too. If gh isn't installed yet, the staged hosts.yml
 * still authorizes gh once it is.
 */
async function injectGhCredentials(
  target: ContainerTarget,
  creds: GhCredentials,
): Promise<{ ok: boolean; error?: string }> {
  const protocol = creds.gitProtocol || 'https';
  // The hosts.yml header (everything but the token) is non-secret, so build it in
  // JS and pass it via printf; only the token rides in over the scrubbed $DCM_STDIN var.
  const header =
    `${GH_HOST}:\n    git_protocol: ${protocol}\n` +
    (creds.user ? `    user: ${creds.user}\n` : '');
  const script =
    'set -e; d=~/.config/gh; mkdir -p "$d"; tok="$DCM_STDIN"; ' +
    `{ printf '%s' "$1"; printf '    oauth_token: %s\\n' "$tok"; } > "$d/hosts.yml"; ` +
    'chmod 600 "$d/hosts.yml"; ' +
    `command -v gh >/dev/null 2>&1 && gh auth setup-git --hostname ${GH_HOST} 2>/dev/null || true`;
  const res = await execInContainer(target, {
    script,
    stdin: creds.token,
    args: ['gh-inject', header],
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Inject the host's GitHub CLI auth so `gh` and git-over-HTTPS work inside the
 * container. Skipped (with a log line) when the host has no credentials.
 */
export const githubCredentials: Injection = {
  id: 'github-credentials',
  label: 'GitHub CLI',

  auth: {
    hint: 'run `gh auth login`',
    async status() {
      const found = await readGhToken();
      return found
        ? { available: true, source: found.source }
        : { available: false, source: null };
    },
  },

  async apply(target, log) {
    const creds = await readGhCredentials();
    if (!creds) {
      log('⚠ No GitHub CLI credentials found on host; skipped gh injection\n');
      return;
    }
    log('Injecting GitHub CLI credentials…\n');
    const injected = await injectGhCredentials(target, creds);
    log(
      injected.ok
        ? '✓ GitHub CLI authorized in container\n'
        : `⚠ gh auth injection failed: ${injected.error}\n`,
    );
  },

  async check(target) {
    return checkPresence(target, '[ -s ~/.config/gh/hosts.yml ] && echo 1 || echo 0');
  },
};
