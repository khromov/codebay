<script lang="ts">
	let {
		variant = 'text',
		width
	}: {
		variant?: 'text' | 'pill' | 'wide';
		width?: string;
	} = $props();
</script>

<span class="skel {variant}" style:width></span>

<style>
	.skel {
		display: inline-block;
		height: 0.95em;
		/* The centre stop has to out-lighten --rule-soft for the sweep to read as a
		   highlight, which --bg-card does not do in dark. */
		background: linear-gradient(
			90deg,
			var(--rule-soft) 25%,
			var(--skel-sheen) 50%,
			var(--rule-soft) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
		vertical-align: middle;
	}
	.skel.wide {
		width: min(420px, 60vw);
	}
	.skel.pill {
		width: 64px;
		height: 18px;
		border-radius: 999px;
	}
	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
