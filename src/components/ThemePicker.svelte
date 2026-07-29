<script lang="ts">
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import { getTheme, setTheme, applyTheme, type Theme } from '../theme.ts';

	let theme: Theme = $state(getTheme());

	const options: { value: Theme; label: string; icon: typeof Sun }[] = [
		{ value: 'auto', label: 'Auto', icon: Monitor },
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon }
	];

	function select(value: Theme) {
		theme = value;
		setTheme(value);
		applyTheme(value);
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

<style>
	.picker {
		display: inline-flex;
		flex: none;
		border: 1px solid var(--ink);
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
		border-left: 1px solid var(--ink);
	}
	.segment:hover:not(.active) {
		background: var(--ink);
		color: var(--bg);
	}
	.segment.active {
		font-weight: 700;
		background: var(--ink);
		color: var(--bg);
		cursor: default;
	}
	.segment:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}
</style>
