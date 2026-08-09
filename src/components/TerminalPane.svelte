<script lang="ts">
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal } from '@xterm/xterm';
	import type { FitAddon } from '@xterm/addon-fit';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';

	let { id, active }: { id: string; active: boolean } = $props();

	let el: HTMLDivElement;
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	let ws: WebSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	let connected = $state(false);
	// Bumped whenever a socket is abandoned, so its late handlers can't resurrect a retry loop.
	let gen = 0;

	// ttyd's wire protocol: a single command byte prefixes every frame, sent as binary
	// (matching ttyd's own client — libwebsockets delivers the raw bytes to the server).
	const CMD_INPUT = '0';
	const CMD_RESIZE = '1';
	const OUTPUT = 0x30; // '0'
	const encoder = new TextEncoder();

	function send(data: string) {
		if (ws?.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
	}

	function onFrame(data: ArrayBuffer) {
		const bytes = new Uint8Array(data);
		if (bytes.length === 0) return;
		// Only OUTPUT carries terminal bytes; SET_WINDOW_TITLE/SET_PREFERENCES are ignored.
		if (bytes[0] === OUTPUT) term?.write(bytes.subarray(1));
	}

	function connect() {
		const myGen = ++gen;
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		// Same-origin through the proxy, which forwards the required `tty` subprotocol to ttyd.
		const sock = new WebSocket(`${proto}//${location.host}/p/${id}/ws`, ['tty']);
		ws = sock;
		sock.binaryType = 'arraybuffer';
		sock.onopen = () => {
			if (gen !== myGen) return;
			connected = true;
			// ttyd's init frame is raw JSON (its leading `{` is the JSON_DATA command byte).
			send(JSON.stringify({ AuthToken: '', columns: term?.cols ?? 80, rows: term?.rows ?? 24 }));
		};
		sock.onmessage = (e) => {
			if (gen === myGen) onFrame(e.data as ArrayBuffer);
		};
		sock.onclose = () => {
			if (gen !== myGen || disposed) return;
			connected = false;
			retry = setTimeout(connect, 1000);
		};
		sock.onerror = () => {
			try {
				sock.close();
			} catch {
				/* already closing */
			}
		};
	}

	/**
	 * Rebuild only the client half — the socket and xterm's buffer — and reattach to the same tmux
	 * session, so a wedged socket (dead wifi, resumed laptop) recovers without touching the container.
	 */
	function reload() {
		if (retry) clearTimeout(retry);
		gen++;
		connected = false;
		// tmux repaints the current screen on attach; without a reset that repaint lands under stale output.
		term?.reset();
		const old = ws;
		ws = undefined;

		let started = false;
		const start = () => {
			if (started || disposed) return;
			started = true;
			fitSafe();
			connect();
			if (active) term?.focus();
		};

		if (old && old.readyState !== WebSocket.CLOSED) {
			// Let the old tmux client detach first, or tmux sizes the window to the smaller of the two.
			old.addEventListener('close', start, { once: true });
			setTimeout(start, 1500);
			try {
				old.close();
			} catch {
				/* already closing */
			}
		} else {
			start();
		}
	}

	function fitSafe() {
		// A hidden pane (display:none) has no size, so fitting there would throw or size to 0.
		if (el?.clientWidth > 0 && el?.clientHeight > 0) {
			try {
				fit?.fit();
			} catch {
				/* transient zero-size during layout */
			}
		}
	}

	function applyTheme() {
		if (!term) return;
		const cs = getComputedStyle(document.documentElement);
		const bg = cs.getPropertyValue('--bg').trim() || '#1a1a1a';
		const fg = cs.getPropertyValue('--ink').trim() || '#e6e6e6';
		term.options.theme = { background: bg, foreground: fg, cursor: fg, cursorAccent: bg };
	}

	onMount(() => {
		let themeObs: MutationObserver | undefined;
		(async () => {
			const [{ Terminal }, { FitAddon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit')
			]);
			if (disposed) return;
			term = new Terminal({
				fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
				fontSize: 13,
				cursorBlink: true,
				scrollback: 10000,
				allowProposedApi: true
			});
			fit = new FitAddon();
			term.loadAddon(fit);
			term.open(el);
			applyTheme();
			fitSafe();
			term.onData((d) => send(CMD_INPUT + d));
			term.onResize(({ cols, rows }) => send(CMD_RESIZE + JSON.stringify({ columns: cols, rows })));
			// The theme cookie flips data-theme on <html>; re-derive xterm's colors when it does.
			themeObs = new MutationObserver(applyTheme);
			themeObs.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme']
			});
			connect();
			if (active) term.focus();
		})();

		const onResize = () => fitSafe();
		window.addEventListener('resize', onResize);

		return () => {
			disposed = true;
			window.removeEventListener('resize', onResize);
			themeObs?.disconnect();
			if (retry) clearTimeout(retry);
			try {
				ws?.close();
			} catch {
				/* already closing */
			}
			term?.dispose();
		};
	});

	// A hidden xterm can't measure itself, so refit/focus the moment this pane becomes active.
	$effect(() => {
		if (active && term) {
			fitSafe();
			term.focus();
		}
	});
</script>

<div class="term" bind:this={el}></div>
<div class="overlay">
	{#if !connected}
		<span class="status">connecting…</span>
	{/if}
	<button
		class="reload"
		type="button"
		onclick={reload}
		title="Reload terminal (reconnects, keeps the session)"
		aria-label="Reload terminal"><RotateCw size={14} /></button
	>
</div>

<style>
	.term {
		width: 100%;
		height: 100%;
		background: var(--bg);
		padding: 6px 8px;
		box-sizing: border-box;
	}
	/* xterm's viewport should own the scroll, not the pane. */
	.term :global(.xterm),
	.term :global(.xterm-viewport) {
		height: 100%;
	}
	/* Floats over live terminal output, so only the button itself takes clicks. */
	.overlay {
		position: absolute;
		top: 6px;
		right: 8px;
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.status {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.reload {
		pointer-events: auto;
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		cursor: pointer;
		background: var(--bg);
		border: 1px solid var(--rule);
		color: var(--ink);
		opacity: 0.3;
		transition: opacity 0.15s ease;
	}
	.reload:hover,
	.reload:focus-visible {
		opacity: 1;
		background: var(--ink);
		color: var(--bg);
	}
	@media (prefers-reduced-motion: reduce) {
		.reload {
			transition: none;
		}
	}
</style>
