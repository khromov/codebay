<script lang="ts">
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { getTheme, setTheme, type Theme } from '../theme.ts';

	// svelte-ignore state_referenced_locally
	let theme: Theme = $state(getTheme());

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		setTheme(theme);
		document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : '';
	}
</script>

<button
	type="button"
	class="toggle"
	onclick={toggle}
	aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
	title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if theme === 'dark'}
		<Sun size={16} />
	{:else}
		<Moon size={16} />
	{/if}
</button>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--ink);
		background: var(--bg-card);
		color: var(--ink);
	}
	.toggle:hover {
		background: var(--ink);
		color: var(--bg);
	}
</style>
