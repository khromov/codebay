<script lang="ts">
	// With a drop handler the overlay takes the drop itself (an iframe beneath would swallow it);
	// without one it stays inert and the drop lands on whatever is underneath.
	let { ondrop }: { ondrop?: (e: DragEvent) => void } = $props();
</script>

<div
	class="dropzone"
	class:catches={ondrop}
	role="presentation"
	ondragover={ondrop ? (e) => e.preventDefault() : undefined}
	{ondrop}
>
	<!-- Two interleaved dot patterns taking turns, like alternating LCD segments. -->
	<svg class="frame" aria-hidden="true">
		<rect class="dots" width="100%" height="100%" />
		<rect class="dots odd" width="100%" height="100%" />
	</svg>
	<span class="label">Drop to save into codebay-inbox/</span>
</div>

<style>
	.dropzone {
		--gutter: 16px;
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		color: var(--ink);
		font-family: var(--font-mono);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 13px;
		pointer-events: none;
	}
	.dropzone.catches {
		pointer-events: auto;
	}
	/* An inline svg sizes like a replaced element, so insets alone won't stretch it. */
	.frame {
		position: absolute;
		top: var(--gutter);
		left: var(--gutter);
		width: calc(100% - 2 * var(--gutter));
		height: calc(100% - 2 * var(--gutter));
		overflow: visible;
	}
	.dots {
		fill: none;
		stroke: currentColor;
		stroke-width: 4;
		stroke-dasharray: 4 12;
		animation: segment 2s step-end infinite;
	}
	.dots.odd {
		stroke-dashoffset: 8;
		animation-delay: -1s;
	}
	@keyframes segment {
		50% {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dots {
			animation: none;
		}
	}
	/* Positioned so it paints above the frame, which comes first in source order. */
	.label {
		position: relative;
	}
</style>
