/**
 * Parsing for Git repository URLs, shared by the server (clone logic) and the
 * client (folder-picker icon selection). Pure string logic — no server imports —
 * so it is safe to include in the hydrated client bundle.
 */

export interface ParsedRepo {
	/** Hostname, e.g. `github.com`. */
	host: string;
	owner: string;
	/** Repository name, `.git` suffix stripped. */
	repo: string;
	/** Normalized https clone URL: `https://<host>/<owner>/<repo>.git`. */
	cloneUrl: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Parse a Git repository URL into its parts, or return null when the input is not
 * a recognizable repo URL. Accepts:
 *   - `https://github.com/owner/repo(.git)` (and `http://`)
 *   - `ssh://git@github.com/owner/repo(.git)`
 *   - `git@github.com:owner/repo(.git)` (scp-like)
 *   - `github.com/owner/repo(.git)` (schemeless, requires a dotted host)
 * Absolute local paths (`/Users/…`) have no dotted host prefix and so never match.
 */
export function parseRepoUrl(input: string): ParsedRepo | null {
	const raw = input.trim();
	if (!raw) return null;

	let host: string | undefined;
	let path: string | undefined;

	const scp = raw.match(/^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(.+)$/);
	if (scp) {
		host = scp[1];
		path = scp[2];
	} else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return null;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ssh:') {
			return null;
		}
		host = url.hostname;
		path = url.pathname;
	} else {
		// Schemeless: require a dotted host as the first segment so bare/relative paths don't match.
		const m = raw.match(/^([A-Za-z0-9-]+\.[A-Za-z0-9.-]+)\/(.+)$/);
		if (!m) return null;
		host = m[1];
		path = m[2];
	}

	if (!host || !path) return null;

	const segments = path
		.replace(/\.git$/i, '')
		.split('/')
		.filter(Boolean);
	const [owner, repo] = segments;
	if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;

	return { host, owner, repo, cloneUrl: `https://${host}/${owner}/${repo}.git` };
}

/** True when the input looks like a Git repository URL (vs. a local folder path). */
export function isRepoUrl(input: string): boolean {
	return parseRepoUrl(input) !== null;
}
