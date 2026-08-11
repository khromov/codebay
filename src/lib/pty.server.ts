import type { NonoPane } from './nono.server.ts';

/**
 * Host PTY sessions, keyed by instance and pane. Deliberately knows nothing about nono: the
 * caller hands in the argv, which keeps the sandbox policy in one place and lets these mechanics
 * be exercised against a plain binary.
 */

/** A live PTY plus whatever socket is currently watching it; `sink` is null while detached. */
interface Session {
	/** Null only for the instant between constructing the terminal and spawning onto it. */
	proc: Bun.Subprocess | null;
	terminal: Bun.Terminal;
	/** Rolling raw output, replayed on attach so a reconnecting client repaints its screen. */
	scrollback: Uint8Array[];
	scrollbackBytes: number;
	sink: ((data: Uint8Array) => void) | null;
	exited: boolean;
}

/** ~256 KB is several screens of scrollback — enough to repaint, cheap to hold per pane. */
const SCROLLBACK_MAX_BYTES = 256 * 1024;

// Pinned to globalThis so dev-mode hot reload doesn't orphan live PTYs (same reason as the hub).
const globalForPty = globalThis as unknown as { __codebayPty?: Map<string, Session> };
const sessions: Map<string, Session> = (globalForPty.__codebayPty ??= new Map());

function key(instanceId: string, pane: NonoPane): string {
	return `${instanceId}:${pane}`;
}

function emit(session: Session, data: Uint8Array): void {
	session.scrollback.push(data);
	session.scrollbackBytes += data.byteLength;
	// Keep at least one chunk, or a single oversized write would empty the buffer entirely.
	while (session.scrollbackBytes > SCROLLBACK_MAX_BYTES && session.scrollback.length > 1) {
		session.scrollbackBytes -= session.scrollback.shift()!.byteLength;
	}
	try {
		session.sink?.(data);
	} catch {
		// A socket that closed mid-write; the next attach installs a fresh sink anyway.
		session.sink = null;
	}
}

function spawn(
	instanceId: string,
	pane: NonoPane,
	argv: string[],
	cwd: string,
	cols: number,
	rows: number
): Session {
	const terminal = new Bun.Terminal({
		cols,
		rows,
		// `session` is initialized before any PTY read can be delivered, so the closure is safe.
		data: (_terminal, data) => emit(session, data)
	});
	const session: Session = {
		proc: null,
		terminal,
		scrollback: [],
		scrollbackBytes: 0,
		sink: null,
		exited: false
	};
	session.proc = Bun.spawn(argv, {
		cwd,
		env: { ...process.env, TERM: 'xterm-256color' },
		terminal
	});
	// The HTTP listener already holds the loop open; keeping a ref here would block shutdown.
	terminal.unref();

	void session.proc.exited.then((code) => {
		session.exited = true;
		emit(session, new TextEncoder().encode(`\r\n[process exited with code ${code}]\r\n`));
		// Dropped so the next attach spawns a fresh session instead of adopting a dead handle.
		if (sessions.get(key(instanceId, pane)) === session) sessions.delete(key(instanceId, pane));
	});
	return session;
}

/**
 * Get-or-spawn the pane's PTY, replay its scrollback to the new sink, then stream live output.
 * Single-attach by design: a second socket displaces the first rather than interleaving writes.
 */
export function attachSession(opts: {
	instanceId: string;
	pane: NonoPane;
	/** Only consulted when there is no live session — a reattach never respawns. */
	argv: string[];
	cwd: string;
	cols: number;
	rows: number;
	sink: (data: Uint8Array) => void;
}): void {
	const k = key(opts.instanceId, opts.pane);
	let session = sessions.get(k);
	if (!session) {
		session = spawn(opts.instanceId, opts.pane, opts.argv, opts.cwd, opts.cols, opts.rows);
		sessions.set(k, session);
	}
	session.sink = opts.sink;
	for (const chunk of session.scrollback) opts.sink(chunk);
	// The arriving client's geometry wins; a stale size leaves the reattached screen misdrawn.
	resizeSession(opts.instanceId, opts.pane, opts.cols, opts.rows);
}

/** Only clears the sink if it's still ours — a displaced socket must not detach its replacement. */
export function detachSession(
	instanceId: string,
	pane: NonoPane,
	sink: (data: Uint8Array) => void
): void {
	const session = sessions.get(key(instanceId, pane));
	if (session?.sink === sink) session.sink = null;
}

export function writeSession(instanceId: string, pane: NonoPane, data: string): void {
	const session = sessions.get(key(instanceId, pane));
	if (!session || session.exited) return;
	try {
		session.terminal.write(data);
	} catch {
		/* the PTY closed between the lookup and the write */
	}
}

export function resizeSession(
	instanceId: string,
	pane: NonoPane,
	cols: number,
	rows: number
): void {
	const session = sessions.get(key(instanceId, pane));
	if (!session || session.exited || cols <= 0 || rows <= 0) return;
	try {
		session.terminal.resize(cols, rows);
	} catch {
		/* the PTY closed between the lookup and the resize */
	}
}

/** Tears down every pane of one instance; called on stop and delete. */
export function killSessions(instanceId: string): void {
	for (const pane of ['claude', 'shell'] as NonoPane[]) {
		const k = key(instanceId, pane);
		const session = sessions.get(k);
		if (!session) continue;
		// Deleted first so the `exited` handler doesn't race us for the same key.
		sessions.delete(k);
		session.sink = null;
		try {
			session.proc?.kill();
		} catch {
			/* already exited */
		}
		try {
			session.terminal.close();
		} catch {
			/* already closed */
		}
	}
}

export function hasSession(instanceId: string, pane: NonoPane): boolean {
	return sessions.has(key(instanceId, pane));
}
