import type { StreamEvent } from './lib/instances.server.ts';

/**
 * Reconnecting WebSocket helper for the live streams. WebSockets (unlike
 * EventSource) don't auto-reconnect, so we reopen with a short backoff whenever
 * the socket closes. Browser-only — call it from inside an `$effect`.
 *
 * Returns a cleanup function that suppresses further reconnects and closes the
 * current socket.
 */
export function liveSocket(
	path: string,
	onMessage: (data: string) => void,
	onOpen?: () => void
): () => void {
	let ws: WebSocket | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	const connect = () => {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}${path}`);
		ws.onopen = () => onOpen?.();
		ws.onmessage = (e) => onMessage(e.data as string);
		ws.onclose = () => {
			if (!closed) timer = setTimeout(connect, 1000);
		};
		ws.onerror = () => ws?.close();
	};
	connect();

	return () => {
		closed = true;
		if (timer) clearTimeout(timer);
		ws?.close();
	};
}

/**
 * Subscribe to the central `/api/stream` socket and receive parsed, typed
 * `StreamEvent`s — malformed frames are silently dropped. Wraps `liveSocket` so
 * each caller no longer repeats the JSON.parse + try/catch + type guard.
 */
export function liveStream(onEvent: (event: StreamEvent) => void, onOpen?: () => void): () => void {
	return liveSocket(
		'/api/stream',
		(raw) => {
			let msg: StreamEvent;
			try {
				msg = JSON.parse(raw) as StreamEvent;
			} catch {
				return; // ignore malformed frame
			}
			onEvent(msg);
		},
		onOpen
	);
}
