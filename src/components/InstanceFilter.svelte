<script lang="ts">
	import type { InstanceFilter } from '../types.ts';

	let { value, onchange }: { value: InstanceFilter; onchange: (v: InstanceFilter) => void } =
		$props();

	const options: { value: InstanceFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'active', label: 'Active' },
		{ value: 'stopped', label: 'Stopped' }
	];
</script>

<div class="picker" role="radiogroup" aria-label="Filter instances">
	{#each options as opt (opt.value)}
		<button
			type="button"
			class="segment"
			class:active={value === opt.value}
			role="radio"
			aria-checked={value === opt.value}
			onclick={() => onchange(opt.value)}
		>
			{opt.label}
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
