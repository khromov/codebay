<script lang="ts">
	// The easter-egg trigger: a little arcade "NEW!" coin idly flipping between
	// two decorative pixel rules. The coin is itself a dot-matrix sprite — drawn
	// in the same medium the editor it opens lets you draw in. (The theme bans
	// border-radius globally, so "round" here means round in pixels.)
	import type { AvatarArt } from '../avatars/types.ts';
	import Avatar from './Avatar.svelte';

	let { onclick }: { onclick: () => void } = $props();

	const coinArt: AvatarArt = {
		name: 'coin',
		pixels: [
			'..####..',
			'.#....#.',
			'#..##..#',
			'#.####.#',
			'#.####.#',
			'#..##..#',
			'.#....#.',
			'..####..'
		]
	};
</script>

<div class="coin-row">
	<span class="pixel-line" aria-hidden="true"></span>
	<button class="coin-btn" {onclick} aria-label="Draw your own avatar" title="Draw your own avatar">
		<span class="new" aria-hidden="true">New</span>
		<span class="coin" aria-hidden="true">
			<Avatar art={coinArt} name="coin" scale={3} />
		</span>
	</button>
	<span class="pixel-line" aria-hidden="true"></span>
</div>

<style>
	.coin-row {
		width: 100%;
		max-width: 560px;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 8px 0;
	}
	/* Dotted LED rule: square dots, like a row of unlit pixels. */
	.pixel-line {
		flex: 1;
		height: 2px;
		background: repeating-linear-gradient(90deg, var(--rule) 0 2px, transparent 2px 6px);
	}
	.coin-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		flex: none;
		padding: 4px;
		border: none;
		background: none;
		cursor: pointer;
	}
	.new {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 8px;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--ink-soft);
		animation: coin-blink 2.6s steps(1, end) infinite;
	}
	.coin {
		display: block;
		box-shadow: 2px 2px 0 var(--ink);
		animation: coin-spin 2.6s ease-in-out infinite;
	}
	/* Hovering "catches" the coin: the spin stops (it would otherwise override
	   the transform) and it presses into its shadow. */
	.coin-btn:hover .coin {
		animation: none;
		transform: translate(1px, 1px);
		box-shadow: 1px 1px 0 var(--ink);
	}
	.coin-btn:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	/* One edge-on flip per cycle, holding face-out most of the time. The sprite
	   is symmetric, so the mirrored "back" reads as the same coin. */
	@keyframes coin-spin {
		0%,
		55% {
			transform: scaleX(1);
		}
		66% {
			transform: scaleX(0.12);
		}
		78% {
			transform: scaleX(-1);
		}
		89% {
			transform: scaleX(0.12);
		}
		100% {
			transform: scaleX(1);
		}
	}
	@keyframes coin-blink {
		0%,
		55%,
		100% {
			opacity: 1;
		}
		66%,
		89% {
			opacity: 0.25;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.coin,
		.new {
			animation: none;
		}
	}
</style>
