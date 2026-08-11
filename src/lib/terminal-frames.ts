/**
 * The wire format `TerminalPane.svelte` already speaks. It originated as ttyd's protocol — one
 * command byte per binary frame — and sandbox mode reimplements it host-side rather than inventing
 * a second one, so the same client component drives both a proxied ttyd and a local PTY.
 */

export const CMD_INPUT = '0';
export const CMD_RESIZE = '1';
/** `'0'` — the only server→client command the client acts on. */
export const CMD_OUTPUT = 0x30;

export type ClientFrame =
	| { type: 'init'; cols: number; rows: number }
	| { type: 'input'; data: string }
	| { type: 'resize'; cols: number; rows: number }
	| { type: 'unknown' };

function geometry(raw: string): { cols: number; rows: number } | null {
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const cols = Number(parsed.columns);
		const rows = Number(parsed.rows);
		if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return null;
		return { cols, rows };
	} catch {
		return null;
	}
}

/**
 * The init frame is raw JSON with no command byte — its leading `{` doubles as ttyd's JSON_DATA
 * command, which is why it's distinguished by shape rather than by prefix.
 */
export function decodeClientFrame(raw: string): ClientFrame {
	if (raw.length === 0) return { type: 'unknown' };
	if (raw.startsWith('{')) {
		const size = geometry(raw);
		return size ? { type: 'init', ...size } : { type: 'unknown' };
	}
	const body = raw.slice(1);
	if (raw[0] === CMD_INPUT) return { type: 'input', data: body };
	if (raw[0] === CMD_RESIZE) {
		const size = geometry(body);
		return size ? { type: 'resize', ...size } : { type: 'unknown' };
	}
	return { type: 'unknown' };
}

/** Prefixes raw PTY bytes with the OUTPUT command byte the client strips back off. */
export function encodeOutput(data: Uint8Array): Uint8Array {
	const frame = new Uint8Array(data.byteLength + 1);
	frame[0] = CMD_OUTPUT;
	frame.set(data, 1);
	return frame;
}
