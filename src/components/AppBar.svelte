<script lang="ts">
	import type { Snippet } from 'svelte';
	import House from '@lucide/svelte/icons/house';
	import { onBackLinkClick } from '../lib/popup-nav.ts';

	let { children }: { children?: Snippet } = $props();
</script>

<header class="bar">
	<a
		class="home"
		href="/"
		title="All instances"
		aria-label="All instances"
		onclick={onBackLinkClick}><House size={18} /></a
	>
	{@render children?.()}
</header>

<style>
	.bar {
		display: flex;
		align-items: stretch;
		gap: 0;
		height: 44px;
		border-bottom: 1px solid var(--rule);
		background: var(--bg-card);
	}
	.home {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		flex: none;
		color: var(--ink);
		border-right: 1px solid var(--rule);
	}
	.home:hover {
		background: var(--ink);
		color: var(--bg);
	}
</style>
