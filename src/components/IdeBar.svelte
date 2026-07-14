<script lang="ts">
	import { type Instance } from '../types.ts';
	import Settings from '@lucide/svelte/icons/settings';
	import Avatar from './Avatar.svelte';
	import AppBar from './AppBar.svelte';

	let {
		running,
		active,
		attention,
		editingId,
		editingName = $bindable(),
		onselect,
		onstartrename,
		oncommitrename,
		oncancelrename
	}: {
		running: Instance[];
		active: string;
		attention: Record<string, 'done' | 'waiting' | null>;
		editingId: string | null;
		editingName: string;
		onselect: (id: string) => void;
		onstartrename: (instance: Instance) => void;
		oncommitrename: (id: string) => void;
		oncancelrename: () => void;
	} = $props();
</script>

<AppBar>
	{#if running.length > 0}
		<nav class="tabs">
			{#each running as inst (inst.id)}
				<div
					class="tab"
					class:active={inst.id === active}
					class:attn-done={inst.id !== active && attention[inst.id] === 'done'}
					class:attn-waiting={inst.id !== active && attention[inst.id] === 'waiting'}
				>
					{#if editingId === inst.id}
						<div class="tab-label editing">
							<Avatar id={inst.id} name={inst.name} scale={4} />
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="tab-name-edit"
								bind:value={editingName}
								autofocus
								onblur={() => oncommitrename(inst.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
									else if (e.key === 'Escape') oncancelrename();
								}}
							/>
						</div>
					{:else}
						<button
							type="button"
							class="tab-label"
							onclick={() => onselect(inst.id)}
							ondblclick={() => onstartrename(inst)}
							title={inst.name}
						>
							<Avatar id={inst.id} name={inst.name} scale={4} />
							<span class="tab-name">{inst.name}</span>
						</button>
					{/if}
				</div>
			{/each}
		</nav>
	{/if}
	<a class="cog" href="/settings" title="Settings" aria-label="Settings"><Settings size={18} /></a>
</AppBar>

<style>
	.cog {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		flex: none;
		margin-left: auto;
		color: var(--ink);
		border-left: 1px solid var(--rule);
	}
	.cog:hover {
		background: var(--ink);
		color: var(--bg);
	}
	.tabs {
		display: flex;
		align-items: stretch;
		overflow-x: auto;
		min-width: 0;
	}
	.tab {
		display: inline-flex;
		align-items: stretch;
		border-right: 1px solid var(--rule-soft);
	}
	.tab.active {
		background: var(--ink);
	}
	/* Attention pulse raised by the in-container Claude hook. The focused tab never
     gets these classes, so a pulsing tab always means "needs your eyes". */
	.tab.attn-done {
		animation: attn-pulse-green 1.8s ease-in-out infinite;
	}
	.tab.attn-waiting {
		animation: attn-pulse-amber 1.8s ease-in-out infinite;
	}
	@keyframes attn-pulse-green {
		0%,
		100% {
			background: transparent;
			box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--attn-done) 40%, transparent);
		}
		50% {
			background: color-mix(in srgb, var(--attn-done) 32%, transparent);
			box-shadow: inset 0 -2px 0 var(--attn-done);
		}
	}
	@keyframes attn-pulse-amber {
		0%,
		100% {
			background: transparent;
			box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--attn-waiting) 40%, transparent);
		}
		50% {
			background: color-mix(in srgb, var(--attn-waiting) 32%, transparent);
			box-shadow: inset 0 -2px 0 var(--attn-waiting);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tab.attn-done,
		.tab.attn-waiting {
			animation-duration: 0s;
			background: color-mix(in srgb, var(--attn-done) 28%, transparent);
		}
		.tab.attn-waiting {
			background: color-mix(in srgb, var(--attn-waiting) 28%, transparent);
		}
	}
	.tab-label {
		appearance: none;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: var(--ink-soft);
		font-family: var(--font-mono);
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 0 12px;
		max-width: 240px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.tab-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab:not(.active) .tab-label:hover {
		color: var(--ink);
	}
	.tab.active .tab-label {
		color: var(--bg);
	}
	.tab-label.editing {
		cursor: default;
	}
	.tab-name-edit {
		width: 130px;
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
		padding: 2px 4px;
		border: 1px solid var(--ink-soft);
		background: var(--bg);
		color: var(--ink);
		outline: none;
	}
</style>
