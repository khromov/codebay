import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_TOKEN } from '../lib/config.server.ts';
import { getOption } from '../lib/db.server.ts';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** The default GitHub host — where the Settings manual-token / env var overrides apply. */
const GH_HOST = 'github.com';

/**
 * A token entered by the user in Settings, or null. Only honored when the
 * "set tokens manually" toggle is on; a blank field falls through to the env
 * var / host discovery so a user can set just one provider. Applies only to the
 * default `github.com` host — Enterprise hosts are always discovered from `gh`.
 */
function manualGithubToken(): string | null {
	if (getOption('manual_tokens_enabled') !== '1') return null;
	return getOption('manual_github_token')?.trim() || null;
}

/** The host's GitHub CLI auth for one host, ready to stage inside a container. */
interface GhCredentials {
	/** Hostname, e.g. `github.com` or a GitHub Enterprise Server host. */
	host: string;
	token: string;
	/** GitHub login, when cheaply readable from the host's hosts.yml. */
	user?: string;
	/** Preferred git protocol (`https`/`ssh`), defaults to https when unknown. */
	gitProtocol?: string;
}

/**
 * Resolve the GitHub token to inject for one host, plus a human-readable source
 * for display. For the default `github.com` host, an explicit
 * `CODEBAY_GITHUB_TOKEN` override (or a manual Settings token) wins; every host —
 * including `github.com` when neither override applies — falls back to `gh`,
 * which transparently spans its storage backends (macOS Keychain, encrypted file,
 * or GH_TOKEN). Returns null when no token is available for that host.
 */
export async function readGhToken(
	host: string = GH_HOST
): Promise<{ token: string; source: string } | null> {
	if (host === GH_HOST) {
		const manual = manualGithubToken();
		if (manual) return { token: manual, source: 'Settings — manual token' };
		if (GITHUB_TOKEN) return { token: GITHUB_TOKEN, source: 'CODEBAY_GITHUB_TOKEN env var' };
	}
	const token = await spawnCapture(['gh', 'auth', 'token', '--hostname', host]);
	return token ? { token, source: `GitHub CLI — ${host}` } : null;
}

/** Every top-level host key in a `gh` `hosts.yml`, e.g. `github.com`, `ghe.example.com`. */
export function parseGhHosts(raw: string): string[] {
	return [...raw.matchAll(/^([A-Za-z0-9._-]+):$/gm)].map((m) => m[1]!);
}

/** The indented block of lines belonging to `host`'s top-level entry, or null if absent. */
export function ghHostBlock(raw: string, host: string): string | null {
	const lines = raw.split('\n');
	const start = lines.findIndex((l) => l === `${host}:`);
	if (start === -1) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => /^\S/.test(l));
	return rest.slice(0, end === -1 ? rest.length : end).join('\n');
}

async function readGhHostsFile(): Promise<string | null> {
	const file = join(homedir(), '.config', 'gh', 'hosts.yml');
	if (!existsSync(file)) return null;
	try {
		return await readFile(file, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Every GitHub host `gh auth login` has set up on this machine (github.com and/or
 * any GitHub Enterprise Server hosts), read from `~/.config/gh/hosts.yml`.
 */
async function readGhHosts(): Promise<string[]> {
	const raw = await readGhHostsFile();
	if (!raw) return [];
	// Defensive: hosts.yml is written by `gh` itself, but only accept
	// hostname-shaped keys before they're ever interpolated into a shell script.
	return parseGhHosts(raw).filter((h) => /^[A-Za-z0-9.-]+$/.test(h));
}

/**
 * Best-effort read of `user`/`git_protocol` from one host's block in the host's gh
 * config so we can populate them in the container's hosts.yml. The token lives in
 * the keychain, not this file, so a lightweight line parse is enough — no YAML
 * dependency.
 */
async function readGhHostMeta(host: string): Promise<{ user?: string; gitProtocol?: string }> {
	const raw = await readGhHostsFile();
	if (!raw) return {};
	const block = ghHostBlock(raw, host);
	if (!block) return {};
	const user = block.match(/^\s+user:\s*(\S+)/m)?.[1];
	const gitProtocol = block.match(/^\s+git_protocol:\s*(\S+)/m)?.[1];
	return { user, gitProtocol };
}

/**
 * Read the GitHub CLI credentials for every host this machine is authenticated to
 * — every host discovered in `hosts.yml`, plus the default `github.com` even when
 * `hosts.yml` doesn't list it (so the Settings manual-token / env var override
 * still works standalone). Hosts with no resolvable token are dropped.
 */
async function readAllGhCredentials(): Promise<GhCredentials[]> {
	const configured = await readGhHosts();
	const hosts = [...new Set([GH_HOST, ...configured])];
	const creds = await Promise.all(
		hosts.map(async (host): Promise<GhCredentials | null> => {
			const found = await readGhToken(host);
			if (!found) return null;
			const meta = await readGhHostMeta(host);
			return { host, token: found.token, ...meta };
		})
	);
	return creds.filter((c): c is GhCredentials => c !== null);
}

/**
 * Authorize the GitHub CLI inside a running container, for every host resolved on
 * the manager's machine, as the container's remote user. Writes one block per host
 * into `~/.config/gh/hosts.yml` so `gh` is signed in everywhere it is on the host,
 * then runs `gh auth setup-git` per host when the binary exists so `git push`/`pull`
 * over HTTPS is authenticated too. If `gh` isn't installed yet, the staged
 * hosts.yml still authorizes it once it is.
 *
 * Secret handling: every host's `oauth_token` line is written directly into the
 * combined file content, which travels as one `stdin` payload (scrubbed
 * `$CODEBAY_STDIN`, never argv) — `execInContainer` only carries one stdin secret
 * per call, so with more than one host's token to smuggle in, the whole file body
 * (headers included) goes through that channel instead of splitting header/token
 * across `args`/`stdin` the way a single-host file could.
 */
async function injectGhCredentials(
	target: ContainerTarget,
	credsList: GhCredentials[]
): Promise<{ ok: boolean; error?: string }> {
	const body = credsList
		.map(({ host, token, user, gitProtocol }) => {
			const protocol = gitProtocol || 'https';
			return (
				`${host}:\n` +
				`    oauth_token: ${token}\n` +
				`    git_protocol: ${protocol}\n` +
				(user ? `    user: ${user}\n` : '')
			);
		})
		.join('');
	const setupGit = credsList
		.map(
			({ host }) =>
				`command -v gh >/dev/null 2>&1 && gh auth setup-git --hostname ${host} 2>/dev/null || true; `
		)
		.join('');
	const script =
		'set -e; d=~/.config/gh; mkdir -p "$d"; ' +
		'printf \'%s\' "$CODEBAY_STDIN" > "$d/hosts.yml"; chmod 600 "$d/hosts.yml"; ' +
		setupGit;
	const res = await execInContainer(target, { script, stdin: body, args: ['gh-inject'] });
	return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Inject the host's GitHub CLI auth — for every host it's signed in to — so `gh`
 * and git-over-HTTPS work inside the container. Skipped (with a log line) when the
 * host has no credentials for any host.
 */
export const githubCredentials: Injection = {
	id: 'github-credentials',
	label: 'GitHub CLI',

	auth: {
		hint: 'run `gh auth login`',
		async status() {
			const credsList = await readAllGhCredentials();
			return credsList.length
				? { available: true, source: `GitHub CLI — ${credsList.map((c) => c.host).join(', ')}` }
				: { available: false, source: null };
		}
	},

	async apply(target, log) {
		const credsList = await readAllGhCredentials();
		if (!credsList.length) {
			log('⚠ No GitHub CLI credentials found on host; skipped gh injection\n');
			return;
		}
		log(`Injecting GitHub CLI credentials for ${credsList.map((c) => c.host).join(', ')}…\n`);
		const injected = await injectGhCredentials(target, credsList);
		log(
			injected.ok
				? '✓ GitHub CLI authorized in container\n'
				: `⚠ gh auth injection failed: ${injected.error}\n`
		);
	},

	async check(target) {
		return checkPresence(target, '[ -s ~/.config/gh/hosts.yml ] && echo 1 || echo 0');
	}
};
