<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
</script>

<a class="brand" href="/"
	><span class="logo"><Package size={22} /></span><span>Codebay</span><span class="tagline"
		>devcontainer manager</span
	></a
>

<style>
	.brand {
		display: inline-flex;
		align-items: baseline;
		gap: 11px;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: inherit;
		text-decoration: none;
	}
	.logo {
		display: inline-flex;
		align-items: center;
		align-self: center;
	}
	.tagline {
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	@media (max-width: 640px) {
		.tagline {
			display: none;
		}
	}
</style>
