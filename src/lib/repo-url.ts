// Pure string logic with no server imports, because the client bundle uses it too.

export interface ParsedRepo {
	host: string;
	owner: string;
	/** `.git` suffix stripped. */
	repo: string;
	/** Normalized to `https://<host>/<owner>/<repo>.git` regardless of the input form. */
	cloneUrl: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Null for anything unrecognized, which is how a local folder path is told apart from a URL. */
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

export function isRepoUrl(input: string): boolean {
	return parseRepoUrl(input) !== null;
}
