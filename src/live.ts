import type { StreamEvent } from './lib/instances.server.ts';

/**
 * WebSockets don't auto-reconnect the way EventSource does, hence the backoff loop.
 * Browser-only — call it from inside an `$effect`.
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

/** Malformed frames are dropped silently rather than surfaced to the caller. */
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
