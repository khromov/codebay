/**
 * Drives the host's `claude setup-token` flow from the Settings UI, so a
 * long-lived token can be minted without dropping to a terminal.
 *
 * `claude setup-token` is an interactive TUI, not a batch command: it opens a
 * browser at `claude.com/cai/oauth/authorize` and — because its `redirect_uri`
 * points at `platform.claude.com`, not a loopback callback — it finishes by
 * asking the user to paste the resulting code back into the terminal. So this
 * is a two-step flow: `startSetupToken()` runs the CLI under a PTY and returns
 * once the authorize URL is on screen, then `submitSetupCode()` types the
 * pasted code in and scrapes the `sk-ant-oat…` token the CLI prints.
 *
 * The CLI only renders into a real terminal, hence `Bun.spawn`'s `terminal`
 * option. Its output is Ink-rendered — cursor moves, spinners, redraws — so it
 * is never shown to the user; we only pattern-match the few bits that matter.
 * The PTY is deliberately very wide so the authorize URL lands on one line
 * (Ink hard-wraps at the terminal width, and a wrapped URL is unrecoverable).
 *
 * One session at a time: it drives a host process and pops the host's browser.
 */

import { homedir } from 'node:os';

/** Wide enough that the ~350-char authorize URL never wraps. */
const PTY_COLS = 1000;
const PTY_ROWS = 40;

/** How long to wait for the CLI to reach the "paste the code" screen. */
const START_TIMEOUT_MS = 45_000;
/** How long to wait for the token after the code is submitted. */
const EXCHANGE_TIMEOUT_MS = 90_000;
/** Backstop: kill an abandoned session rather than leave the child running. */
const SESSION_MAX_MS = 10 * 60_000;

type Session = {
	proc: Bun.Subprocess;
	decoder: TextDecoder;
	/** Raw PTY output so far, escape codes and all. */
	output: string;
	exited: boolean;
	/** Re-run on every chunk and on exit; see `waitFor`. */
	watchers: Set<() => void>;
	reaper: ReturnType<typeof setTimeout>;
};

// Pin to globalThis so dev-mode hot reload doesn't orphan a running child.
const globalForSetupToken = globalThis as unknown as { __codebaySetupToken?: Session | null };

/**
 * Absolute path to the host's `claude` binary, or null when it isn't installed.
 * `Bun.which` covers the normal case; the native installer's `~/.local/bin` is
 * checked too, since a server started outside a login shell may not have it on
 * PATH.
 */
export function claudeCliPath(): string | null {
	const onPath = Bun.which('claude');
	if (onPath) return onPath;
	const fallback = `${homedir()}/.local/bin/claude`;
	return Bun.file(fallback).size > 0 ? fallback : null;
}

/**
 * Drop terminal escape sequences (OSC, CSI, and stray control bytes) so the
 * output can be pattern-matched. Tabs/newlines/carriage returns are kept —
 * line structure is what tells a wrapped URL from an intact one.
 */
export function stripAnsi(text: string): string {
	return text
		.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
		.replace(/\u001B[[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nqry=><]/g, '')
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * The sign-in URL the CLI prints under "Browser didn't open?", for when the
 * server's own browser isn't the one in front of the user (remote/headless).
 * Only accepted whole: the URL must sit on a single line and still carry the
 * params that make it usable, so a wrapped or half-written line yields null
 * (the link is a convenience — the CLI already opened the browser itself).
 */
export function findAuthorizeUrl(text: string): string | null {
	for (const line of stripAnsi(text).split(/\r?\n/)) {
		const match = line.match(/https?:\/\/\S*\/oauth\/authorize\?\S+/);
		if (!match) continue;
		try {
			const url = new URL(match[0]);
			if (url.searchParams.has('client_id') && url.searchParams.has('state')) return url.toString();
		} catch {
			// Not a parseable URL — keep scanning.
		}
	}
	return null;
}

/**
 * Text with every space removed, which is how on-screen prose has to be matched:
 * Ink positions each word with a cursor-move escape rather than emitting the
 * spaces, so "Paste code here" arrives as `Paste`, move, `code`, move, `here`
 * and reads as `Pastecodehere` once the escapes are gone. Squashing whitespace
 * on both sides matches either rendering.
 */
function squish(text: string): string {
	return stripAnsi(text).replace(/\s+/g, '');
}

/** True once the CLI is parked on its "paste the code from the browser" prompt. */
export function awaitingCode(text: string): boolean {
	return /pastecodehere/i.test(squish(text));
}

/**
 * The minted token, once the CLI has finished writing it.
 *
 * Matched against the *raw* stream on purpose. Escape sequences are not in the
 * token's alphabet, so they bound the match — whereas stripping them first
 * would glue whatever Ink drew next onto the end (see `squish`) and silently
 * yield a longer, wrong token. For the same reason a token arriving split
 * across two PTY reads is only trusted once something follows it in the buffer
 * (or the process has exited and nothing more is coming): half a secret fails
 * later, inside a container, with no clue why.
 */
export function findToken(raw: string, exited: boolean): string | null {
	const pattern = /sk-ant-oat[\dA-Za-z_-]{20,}/g;
	let last: RegExpExecArray | null = null;
	for (let m = pattern.exec(raw); m; m = pattern.exec(raw)) last = m;
	if (!last) return null;
	if (!exited && last.index + last[0].length >= raw.length) return null;
	return last[0];
}

/**
 * An error the CLI reported, e.g. a rejected code or a policy that forbids the
 * command. A rejected code leaves the CLI sitting on "Press Enter to retry",
 * not exiting — so without this the request would just hit its timeout.
 */
export function findCliError(text: string): string | null {
	const squished = squish(text);
	if (/oautherror|invalidauthorizationcode/i.test(squished)) {
		return 'That code was rejected. Start again to get a fresh one — each code works only once.';
	}
	if (/setup-tokencreatesalong-lived/i.test(squished)) {
		return 'A managed policy on this machine forbids `claude setup-token`.';
	}
	return null;
}

/** Last few lines of real text, for an error message when the CLI just dies. */
function outputTail(session: Session): string {
	const lines = stripAnsi(session.output)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	return lines.slice(-3).join(' / ');
}

/** What `startSetupToken` hands back: the sign-in link, or the token if it skipped the prompt. */
export type SetupTokenStart = { authorizeUrl: string | null; token: string | null };

type Probe<T> = (output: string, exited: boolean) => { value: T } | { error: string } | null;

/**
 * Resolve as soon as `probe` recognizes something in the accumulated output.
 * Rejects if the probe reports a CLI error, if the process exits first, or on
 * timeout — a hung child must not leave the HTTP request hanging forever.
 */
function waitFor<T>(session: Session, probe: Probe<T>, timeoutMs: number, timeout: string) {
	return new Promise<T>((resolve, reject) => {
		const settle = (fn: () => void) => {
			clearTimeout(timer);
			session.watchers.delete(check);
			fn();
		};
		const check = () => {
			const hit = probe(session.output, session.exited);
			if (hit) {
				settle(() => ('value' in hit ? resolve(hit.value) : reject(new Error(hit.error))));
			} else if (session.exited) {
				const tail = outputTail(session);
				settle(() =>
					reject(new Error(`\`claude setup-token\` exited early${tail ? `: ${tail}` : '.'}`))
				);
			}
		};
		const timer = setTimeout(() => settle(() => reject(new Error(timeout))), timeoutMs);
		session.watchers.add(check);
		// The buffer may already hold what we're waiting for.
		check();
	});
}

/** Kill the child and forget the session. Safe to call when nothing is running. */
export function cancelSetupToken(): void {
	const session = globalForSetupToken.__codebaySetupToken;
	if (!session) return;
	globalForSetupToken.__codebaySetupToken = null;
	clearTimeout(session.reaper);
	try {
		session.proc.kill();
		session.proc.terminal?.close();
	} catch {
		// Already gone.
	}
}

/**
 * Start `claude setup-token` under a PTY. Returns once the CLI is waiting for
 * the code (with the authorize URL, when it could be read whole) — or, if a
 * future CLI completes without prompting, with the token itself.
 */
export async function startSetupToken(): Promise<SetupTokenStart> {
	const bin = claudeCliPath();
	if (!bin) {
		throw new Error(
			'The `claude` CLI was not found on this machine. Install Claude Code on the host, or paste a token above.'
		);
	}
	// Never run two at once — each one pops a browser window on the host.
	cancelSetupToken();

	const session: Session = {
		proc: undefined as unknown as Bun.Subprocess,
		decoder: new TextDecoder(),
		output: '',
		exited: false,
		watchers: new Set(),
		reaper: setTimeout(() => cancelSetupToken(), SESSION_MAX_MS)
	};
	session.proc = Bun.spawn([bin, 'setup-token'], {
		terminal: {
			cols: PTY_COLS,
			rows: PTY_ROWS,
			data: (_terminal, chunk) => {
				session.output += session.decoder.decode(chunk, { stream: true });
				for (const watcher of [...session.watchers]) watcher();
			}
		}
	});
	void session.proc.exited.then(() => {
		session.exited = true;
		for (const watcher of [...session.watchers]) watcher();
	});
	globalForSetupToken.__codebaySetupToken = session;

	try {
		return await waitFor<SetupTokenStart>(
			session,
			(output, exited) => {
				const cliError = findCliError(output);
				if (cliError) return { error: cliError };
				const token = findToken(output, exited);
				if (token) return { value: { authorizeUrl: null, token } };
				// The prompt is the real signal; the URL is best-effort extra.
				if (awaitingCode(output)) {
					return { value: { authorizeUrl: findAuthorizeUrl(output), token: null } };
				}
				return null;
			},
			START_TIMEOUT_MS,
			'`claude setup-token` did not reach the sign-in step in time.'
		);
	} catch (err) {
		cancelSetupToken();
		throw err;
	}
}

/**
 * Type the code the user copied out of the browser into the waiting CLI and
 * return the token it mints. The session is torn down either way — the CLI
 * lingers on a "press enter" screen after printing the token.
 */
export async function submitSetupCode(code: string): Promise<string> {
	const session = globalForSetupToken.__codebaySetupToken;
	if (!session || session.exited) {
		throw new Error('That sign-in expired. Run `claude setup-token` again.');
	}
	const trimmed = code.trim();
	// Newlines would submit early and control bytes would be typed as keys.
	if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) {
		throw new Error('Paste the code exactly as shown on the browser page.');
	}

	try {
		// Enter, as a terminal delivers it.
		session.proc.terminal?.write(`${trimmed}\r`);
		return await waitFor<string>(
			session,
			(output, exited) => {
				const cliError = findCliError(output);
				if (cliError) return { error: cliError };
				const token = findToken(output, exited);
				return token ? { value: token } : null;
			},
			EXCHANGE_TIMEOUT_MS,
			'Timed out waiting for `claude setup-token` to return a token.'
		);
	} finally {
		cancelSetupToken();
	}
}
