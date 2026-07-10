<script lang="ts">
	import type { Snippet } from 'svelte';
	import House from '@lucide/svelte/icons/house';
	import ThemeToggle from './ThemeToggle.svelte';

	// The shared 44px top bar: a bordered home-icon cell on the left, then whatever
	// the caller renders (IDE tabs + cog, or a settings title). Keeps the two bars
	// visually in lockstep — see IdeBar.svelte and SettingsView.svelte.
	let { children }: { children?: Snippet } = $props();
</script>

<header class="bar">
	<a class="home" href="/" title="All instances" aria-label="All instances"><House size={18} /></a>
	{@render children?.()}
	<div class="spacer"></div>
	<div class="theme-cell"><ThemeToggle /></div>
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
	.spacer {
		flex: 1;
	}
	.theme-cell {
		display: flex;
		align-items: center;
		padding: 0 10px;
		border-left: 1px solid var(--rule);
	}
</style>
