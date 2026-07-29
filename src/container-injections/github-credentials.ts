import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_TOKEN } from '../lib/config.server.ts';
import { getOption } from '../lib/db.server.ts';
import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import { spawnCapture } from '../lib/spawn.server.ts';
import type { ContainerTarget, Injection } from '../lib/injections.server.ts';

/** The only host the Settings and env-var overrides apply to; Enterprise hosts come from `gh`. */
const GH_HOST = 'github.com';

/** A blank field falls through to the env var, so a user can set just one provider. */
function manualGithubToken(): string | null {
	if (getOption('manual_tokens_enabled') !== '1') return null;
	return getOption('manual_github_token')?.trim() || null;
}

interface GhCredentials {
	host: string;
	token: string;
	user?: string;
	/** Defaults to https when unknown. */
	gitProtocol?: string;
}

/** Falls back to `gh`, which transparently spans all its storage backends. */
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

export function parseGhHosts(raw: string): string[] {
	return [...raw.matchAll(/^([A-Za-z0-9._-]+):$/gm)].map((m) => m[1]!);
}

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

async function readGhHosts(): Promise<string[]> {
	const raw = await readGhHostsFile();
	if (!raw) return [];
	// These keys get interpolated into a shell script, so only hostname-shaped ones may pass.
	return parseGhHosts(raw).filter((h) => /^[A-Za-z0-9.-]+$/.test(h));
}

/** A line parse suffices instead of a YAML dependency, since the token isn't in this file. */
async function readGhHostMeta(host: string): Promise<{ user?: string; gitProtocol?: string }> {
	const raw = await readGhHostsFile();
	if (!raw) return {};
	const block = ghHostBlock(raw, host);
	if (!block) return {};
	const user = block.match(/^\s+user:\s*(\S+)/m)?.[1];
	const gitProtocol = block.match(/^\s+git_protocol:\s*(\S+)/m)?.[1];
	return { user, gitProtocol };
}

/** `github.com` is included unconditionally so the manual/env override works with no `gh` setup. */
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
 * Staging hosts.yml still authorizes `gh` if it's installed later. The whole file body
 * rides the single `stdin` channel, because it may hold more than one host's token.
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
