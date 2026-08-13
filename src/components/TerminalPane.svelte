<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal } from '@xterm/xterm';
	import type { FitAddon } from '@xterm/addon-fit';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';

	let {
		id,
		active,
		/** ttyd `--url-arg` value selecting which session to attach to; omitted means Claude's. */
		arg,
		/** Split view: only one of the two panes may claim the keyboard when the tab activates. */
		focus = true,
		/** Extra overlay buttons, rendered left of this pane's own reload button. */
		actions
	}: {
		id: string;
		active: boolean;
		arg?: string;
		focus?: boolean;
		actions?: Snippet;
	} = $props();

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
		// Same-origin through the proxy, which forwards the required `tty` subprotocol to ttyd
		// and passes the query string through untouched.
		const query = arg ? `?arg=${encodeURIComponent(arg)}` : '';
		const sock = new WebSocket(`${proto}//${location.host}/p/${id}/ws${query}`, ['tty']);
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
			if (active && focus) term?.focus();
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

	/* Reads the *resolved* background/color off `.term` rather than the tokens behind
	   them: getPropertyValue('--screen-bg') hands back the literal "light-dark(…)"
	   token stream, which xterm can't parse and silently drops on the floor. */
	function applyTheme() {
		if (!term || !el) return;
		const cs = getComputedStyle(el);
		const bg = cs.backgroundColor || '#0d0e0a';
		const fg = cs.color || '#d8d9cf';
		term.options.theme = { background: bg, foreground: fg, cursor: fg, cursorAccent: bg };
	}

	onMount(() => {
		let themeObs: MutationObserver | undefined;
		// In "auto" there is no data-theme attribute to mutate, so the OS preference
		// flipping is the only signal the mutation observer below would never see.
		const scheme = window.matchMedia('(prefers-color-scheme: dark)');
		const onScheme = () => applyTheme();
		scheme.addEventListener('change', onScheme);
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
			if (active && focus) term.focus();
		})();

		// Observing the element rather than the window also covers split-divider drags and the
		// split opening or closing, which don't resize the window at all.
		const sizeObs = new ResizeObserver(() => fitSafe());
		sizeObs.observe(el);

		return () => {
			disposed = true;
			sizeObs.disconnect();
			themeObs?.disconnect();
			scheme.removeEventListener('change', onScheme);
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
			if (focus) term.focus();
		}
	});
</script>

<div class="term" bind:this={el}></div>
<div class="overlay">
	{#if !connected}
		<span class="status">connecting…</span>
	{/if}
	{@render actions?.()}
	<button
		type="button"
		onclick={reload}
		title="Reload terminal (reconnects, keeps the session)"
		aria-label="Reload terminal"><RotateCw size={14} /></button
	>
</div>

<style>
	/* Also the source `applyTheme` reads xterm's colors back out of — resolved
	   standard properties, since a custom property's own value is unresolved. */
	.term {
		width: 100%;
		height: 100%;
		background: var(--screen-bg);
		color: var(--screen-ink);
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
	/* `:global` so buttons handed in through the `actions` snippet — which carry the parent
	   component's scope, not ours — pick up the same styling. */
	.overlay :global(button) {
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
	.overlay :global(button:hover),
	.overlay :global(button:focus-visible),
	.overlay :global(button[aria-pressed='true']) {
		opacity: 1;
		background: var(--fill);
		color: var(--fill-ink);
	}
	@media (prefers-reduced-motion: reduce) {
		.overlay :global(button) {
			transition: none;
		}
	}
</style>
