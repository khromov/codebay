<script lang="ts">
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import { getTheme, setTheme, applyTheme, type Theme } from '../theme.ts';

	let theme: Theme = $state(getTheme());
	/** Which half of the CRT power-cycle is playing; null when idle. */
	let phase = $state<'collapse' | 'restore' | null>(null);

	// Must match the CSS below: the theme swap has to land while the tube is dark.
	const COLLAPSE_MS = 320;
	const RESTORE_MS = 380;

	const options: { value: Theme; label: string; icon: typeof Sun }[] = [
		{ value: 'auto', label: 'Auto', icon: Monitor },
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon }
	];

	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	async function select(value: Theme) {
		if (value === theme || phase) return;
		// Persist first: an interrupted transition still lands the choice.
		setTheme(value);

		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			theme = value;
			applyTheme(value);
			return;
		}

		phase = 'collapse';
		await wait(COLLAPSE_MS);
		// Swapped behind the black, so the repaint itself is never on screen.
		theme = value;
		applyTheme(value);
		phase = 'restore';
		await wait(RESTORE_MS);
		phase = null;
	}
</script>

<div class="picker" role="radiogroup" aria-label="Theme">
	{#each options as { value, label, icon: Icon } (value)}
		<button
			type="button"
			class="segment"
			class:active={theme === value}
			role="radio"
			aria-checked={theme === value}
			onclick={() => select(value)}
		>
			<Icon size={13} />
			{label}
		</button>
	{/each}
</div>

{#if phase}
	<div class="crt" class:collapse={phase === 'collapse'} class:restore={phase === 'restore'}>
		<span class="bar top"></span>
		<span class="bar bottom"></span>
		<span class="line"></span>
	</div>
{/if}

<style>
	.picker {
		display: inline-flex;
		flex: none;
		border: 1px solid var(--edge);
		background: var(--bg-card);
	}
	.segment {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border: none;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
	}
	.segment + .segment {
		border-left: 1px solid var(--edge);
	}
	.segment:hover:not(.active) {
		background: var(--fill);
		color: var(--fill-ink);
	}
	.segment.active {
		font-weight: 700;
		background: var(--fill);
		color: var(--fill-ink);
		cursor: default;
	}
	.segment:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}

	/* Switching themes power-cycles the monitor. `position: fixed` is viewport-relative
	   only while no ancestor is transformed/filtered — giving one of Settings' wrappers
	   a transform would re-root this to that ancestor instead. */
	.crt {
		position: fixed;
		inset: 0;
		z-index: 9999;
		pointer-events: none;
	}
	/* Black closing in from both edges, squeezing the picture toward the centre —
	   the deflection yoke losing the vertical sweep. */
	.bar {
		position: absolute;
		left: 0;
		right: 0;
		height: 50%;
		background: #000;
	}
	.bar.top {
		top: 0;
		transform-origin: top center;
	}
	.bar.bottom {
		bottom: 0;
		transform-origin: bottom center;
	}
	/* Tracks --screen-ink, so the tube warms back up in the phosphor colour of
	   whichever theme it is coming back as. */
	.line {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 2px;
		margin-top: -1px;
		background: var(--screen-ink);
		box-shadow: 0 0 14px 3px var(--screen-ink);
		opacity: 0;
	}

	.crt.collapse .bar {
		animation: crt-collapse 200ms cubic-bezier(0.7, 0, 0.84, 0) forwards;
	}
	.crt.collapse .line {
		animation: crt-line-out 320ms linear forwards;
	}
	/* Held closed through the delay so the line can bloom before the picture opens. */
	.crt.restore .bar {
		animation: crt-open 260ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
	}
	.crt.restore .line {
		animation: crt-line-in 380ms linear both;
	}

	@keyframes crt-collapse {
		from {
			transform: scaleY(0);
		}
		to {
			transform: scaleY(1);
		}
	}
	@keyframes crt-open {
		from {
			transform: scaleY(1);
		}
		to {
			transform: scaleY(0);
		}
	}
	/* Picture gone: the residual charge flares as a line, pinches to a dot, dies. */
	@keyframes crt-line-out {
		0%,
		55% {
			opacity: 0;
			transform: scaleX(1);
		}
		62%,
		75% {
			opacity: 1;
			transform: scaleX(1);
		}
		100% {
			opacity: 0;
			transform: scaleX(0.015);
		}
	}
	/* Dot blooms back into a line, then the picture opens around it. */
	@keyframes crt-line-in {
		0% {
			opacity: 0;
			transform: scaleX(0.015);
		}
		12% {
			opacity: 1;
			transform: scaleX(0.015);
		}
		32%,
		55% {
			opacity: 1;
			transform: scaleX(1);
		}
		100% {
			opacity: 0;
			transform: scaleX(1);
		}
	}
</style>
