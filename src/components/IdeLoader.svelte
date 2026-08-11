<script lang="ts">
	import Button from './Button.svelte';
	import { isSandboxMode, usesTerminalUi, type InstanceMode } from '../types.ts';

	// A fixed flip count per tick, rather than a per-bit probability, is what keeps
	// the cadence visually even; `speed` scales only the interval, never the churn.
	let {
		speed = 1,
		mode = 'ide',
		// Omit both unless the wait could in principle never end.
		stalledAfterMs,
		onoverride
	}: {
		speed?: number;
		mode?: InstanceMode;
		stalledAfterMs?: number;
		onoverride?: () => void;
	} = $props();

	const isTerminal = $derived(usesTerminalUi(mode));
	// Sandbox mode has no container, so the "waiting" copy would name the wrong thing.
	const isSandbox = $derived(isSandboxMode(mode));

	let stalled = $state(false);
	$effect(() => {
		if (stalledAfterMs === undefined) return;
		const timer = setTimeout(() => (stalled = true), stalledAfterMs);
		return () => clearTimeout(timer);
	});

	const ROWS = 3;
	const COLS = 22;
	const BASE_TICK_MS = 140; // pace at speed = 1: slower than a flicker, calm and readable
	const FLIPS_PER_TICK = 7; // constant churn per tick → stable cadence
	const tickMs = $derived(Math.max(20, BASE_TICK_MS / speed));
	const seed = () =>
		Array.from({ length: ROWS }, () =>
			Array.from({ length: COLS }, () => (Math.random() < 0.5 ? 0 : 1))
		);

	let grid = $state(seed());

	$effect(() => {
		// Reduced-motion gets a static readout rather than no loader at all.
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		const timer = setInterval(() => {
			const next = grid.map((row) => row.slice());
			for (let i = 0; i < FLIPS_PER_TICK; i++) {
				const row = next[Math.floor(Math.random() * ROWS)]!;
				const c = Math.floor(Math.random() * COLS);
				row[c] = row[c] ? 0 : 1;
			}
			grid = next;
		}, tickMs);
		return () => clearInterval(timer);
	});
</script>

<div class="loader">
	<div class="grid" aria-hidden="true">
		{#each grid as row, i (i)}
			<div class="row">{row.join('')}</div>
		{/each}
	</div>
	<div class="label">
		Loading {isTerminal ? 'terminal' : 'editor'}<span class="dot">.</span><span class="dot">.</span
		><span class="dot">.</span>
	</div>
	{#if stalled}
		<div class="stalled">
			<p>
				{#if isSandbox}
					Waiting for the sandboxed shell to start on this machine.
				{:else}
					Waiting for {isTerminal ? 'the terminal' : 'code-server'} to answer inside the container.
				{/if}
			</p>
			{#if onoverride}
				<Button size="sm" onclick={onoverride}>Open anyway</Button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.loader {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 20px;
		background: var(--bg);
		color: var(--ink);
	}
	.grid {
		font-family: var(--font-display);
		font-size: 30px;
		line-height: 1.1;
		letter-spacing: 0.22em;
		color: var(--ink-faint);
	}
	.row {
		white-space: pre;
	}
	.label {
		font-family: var(--font-mono);
		font-size: 18px;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: var(--ink-soft);
	}
	/* Held back until the wait looks wedged, so it reads as an explanation, not boot chrome. */
	.stalled {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		max-width: 34ch;
		text-align: center;
	}
	.stalled p {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.5;
		color: var(--ink-faint);
	}
	.dot {
		animation: blink 1.2s ease-in-out infinite;
	}
	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}
</style>
