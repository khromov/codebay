<script lang="ts">
	// Dot-matrix "data streaming" loader shown while a code-server iframe boots.
	// Each tick flips a fixed number of randomly-chosen bits so the readout looks
	// like flowing data on the LCD-style panel — a steady amount of change every
	// tick (rather than a per-bit probability, which makes some frames churn and
	// others barely move) keeps the cadence visually even.
	// `speed` is a multiplier on the readout's pace: 1 is the default calm cadence,
	// 2 runs twice as fast, 0.5 half as fast. It scales the tick interval only —
	// the per-tick churn stays fixed so the cadence reads as even at any speed.
	let { speed = 1 }: { speed?: number } = $props();

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
		// Honor reduced-motion: leave a static readout, skip the flicker interval.
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
		Loading editor<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
	</div>
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
