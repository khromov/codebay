<script lang="ts">
	import { onMount } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal } from '@xterm/xterm';
	import type { FitAddon } from '@xterm/addon-fit';

	let { id, active }: { id: string; active: boolean } = $props();

	let el: HTMLDivElement;
	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	let ws: WebSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	let connected = $state(false);

	// ttyd's wire protocol: a single command byte prefixes every frame.
	const CMD_INPUT = '0';
	const CMD_RESIZE = '1';
	const OUTPUT = 0x30; // '0'

	function send(data: string) {
		if (ws?.readyState === WebSocket.OPEN) ws.send(data);
	}

	function onFrame(data: ArrayBuffer) {
		const bytes = new Uint8Array(data);
		if (bytes.length === 0) return;
		// Only OUTPUT carries terminal bytes; SET_WINDOW_TITLE/SET_PREFERENCES are ignored.
		if (bytes[0] === OUTPUT) term?.write(bytes.subarray(1));
	}

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		// Same-origin through the proxy, which forwards the required `tty` subprotocol to ttyd.
		ws = new WebSocket(`${proto}//${location.host}/p/${id}/ws`, ['tty']);
		ws.binaryType = 'arraybuffer';
		ws.onopen = () => {
			connected = true;
			// ttyd's init frame is raw JSON (its leading `{` is the JSON_DATA command byte).
			send(JSON.stringify({ AuthToken: '', columns: term?.cols ?? 80, rows: term?.rows ?? 24 }));
		};
		ws.onmessage = (e) => onFrame(e.data as ArrayBuffer);
		ws.onclose = () => {
			connected = false;
			if (!disposed) retry = setTimeout(connect, 1000);
		};
		ws.onerror = () => {
			try {
				ws?.close();
			} catch {
				/* already closing */
			}
		};
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
{#if !connected}
	<div class="status">connecting…</div>
{/if}

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
	.status {
		position: absolute;
		top: 8px;
		right: 12px;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
		pointer-events: none;
	}
</style>
