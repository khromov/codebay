<script lang="ts">
	import { type Instance } from '../types.ts';
	import { findAvatar } from '../avatars/index.ts';
	import Settings from '@lucide/svelte/icons/settings';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Terminal from '@lucide/svelte/icons/terminal';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import Avatar from './Avatar.svelte';
	import AppBar from './AppBar.svelte';
	import { withPopupMarker } from '../lib/popup-nav.ts';

	let {
		running,
		active,
		attention,
		editingId,
		editingName = $bindable(),
		onreload,
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
		/** Absent for terminal tabs, which carry their own reload, and until the iframe exists. */
		onreload?: () => void;
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
							<Avatar
								name={inst.name}
								art={findAvatar(inst.avatar ?? undefined) ?? null}
								scale={4}
							/>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="tab-name-edit"
								bind:value={editingName}
								autofocus
								onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
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
							<Avatar
								name={inst.name}
								art={findAvatar(inst.avatar ?? undefined) ?? null}
								scale={4}
							/>
							<span class="tab-name">{inst.name}</span>
							{#if inst.mode === 'terminal'}
								<span class="tab-mode" title="Terminal-only instance"><Terminal size={13} /></span>
							{:else}
								<span class="tab-mode" title="Full IDE instance"><LayoutTemplate size={13} /></span>
							{/if}
						</button>
					{/if}
				</div>
			{/each}
		</nav>
	{/if}
	<div class="right">
		{#if onreload}
			<button
				type="button"
				class="reload"
				onclick={onreload}
				title="Reload editor"
				aria-label="Reload editor"><RotateCw size={18} /></button
			>
		{/if}
		<a
			class="cog"
			href={withPopupMarker('/settings')}
			target="_blank"
			rel="noopener noreferrer"
			title="Settings"
			aria-label="Settings"><Settings size={18} /></a
		>
	</div>
</AppBar>

<style>
	/* Grouped so the auto-margin doesn't have to move when the reload button comes and goes. */
	.right {
		display: flex;
		align-items: stretch;
		margin-left: auto;
	}
	.cog,
	.reload {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		flex: none;
		color: var(--ink);
		border-left: 1px solid var(--rule);
	}
	.reload {
		appearance: none;
		background: transparent;
		border-top: 0;
		border-right: 0;
		border-bottom: 0;
		padding: 0;
		cursor: pointer;
	}
	.cog:hover,
	.reload:hover {
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
	/* The focused tab never gets these, so a pulsing tab always means "needs your eyes". */
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
	.tab-mode {
		display: inline-flex;
		align-items: center;
		flex: none;
		opacity: 0.75;
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
