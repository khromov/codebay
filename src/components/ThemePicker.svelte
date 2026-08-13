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
	/* A filled segment repaints this divider to match its own fill, since an --edge
	   seam across the slab would read as a rendering artefact. The two tokens are the
	   same colour in light, so only dark mode ever sees the difference. */
	.segment + .segment {
		border-left: 1px solid var(--edge);
	}
	.segment:hover:not(.active) {
		background: var(--slab);
		border-color: var(--slab);
		color: var(--slab-ink);
	}
	.segment.active {
		font-weight: 700;
		background: var(--slab);
		border-color: var(--slab);
		color: var(--slab-ink);
		cursor: default;
	}
	.segment:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}
</style>
