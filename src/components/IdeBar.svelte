<script lang="ts">
	import { type Instance } from '../types.ts';
	import { findAvatar } from '../avatars/index.ts';
	import Settings from '@lucide/svelte/icons/settings';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Terminal from '@lucide/svelte/icons/terminal';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Avatar from './Avatar.svelte';
	import AppBar from './AppBar.svelte';
	import { withPopupMarker } from '../lib/popup-nav.ts';
	import { nextTabIndex } from '../lib/tab-nav.ts';

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

	const activeIndex = $derived(running.findIndex((i) => i.id === active));
	// Falls back to the first tab so the strip always offers exactly one tab stop,
	// even when `active` names an instance that has since stopped.
	const focusIndex = $derived(activeIndex >= 0 ? activeIndex : 0);

	let viewport = $state<HTMLDivElement | null>(null);
	let content = $state<HTMLDivElement | null>(null);
	let atStart = $state(true);
	let atEnd = $state(true);
	// `$state` rather than a plain object so `bind:this` into it is a tracked write —
	// otherwise Svelte warns, and the scroll-into-view effect below misses the first bind.
	const tabEls = $state<Record<string, HTMLButtonElement | null>>({});

	// Both true means everything fits, so the chevrons stay out of a bar that only has 44px.
	const overflowing = $derived(!atStart || !atEnd);

	// 1px of slack: fractional layout widths leave scrollLeft a hair short of the true end.
	function measure() {
		if (!viewport) return;
		atStart = viewport.scrollLeft <= 1;
		atEnd = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
	}

	function select(index: number) {
		const inst = running[index];
		if (!inst) return;
		onselect(inst.id);
		tabEls[inst.id]?.focus();
	}

	function onTabKeydown(e: KeyboardEvent) {
		const next = nextTabIndex(activeIndex, e.key, running.length);
		if (next === null) return;
		e.preventDefault();
		select(next);
	}

	function page(direction: -1 | 1) {
		if (!viewport) return;
		viewport.scrollBy({ left: direction * Math.max(160, viewport.clientWidth * 0.7) });
	}

	// Observing the content too, not just the viewport — adding or removing a tab moves
	// scrollWidth without ever resizing the scroll container.
	$effect(() => {
		const vp = viewport;
		const ct = content;
		if (!vp || !ct) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(vp);
		ro.observe(ct);
		vp.addEventListener('scroll', measure, { passive: true });
		return () => {
			ro.disconnect();
			vp.removeEventListener('scroll', measure);
		};
	});

	// Keyboard selection can land on a tab that's scrolled out of sight.
	$effect(() => {
		tabEls[active]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});
</script>

<AppBar>
	{#if running.length > 0}
		<div class="strip">
			{#if overflowing}
				<button
					type="button"
					class="page"
					disabled={atStart}
					onclick={() => page(-1)}
					aria-label="Scroll tabs left"><ChevronLeft size={16} /></button
				>
			{/if}
			<div class="viewport" bind:this={viewport}>
				<div class="tabs" role="tablist" aria-label="Instances" bind:this={content}>
					{#each running as inst, i (inst.id)}
						{#if editingId === inst.id}
							<div class="tab editing">
								<Avatar
									name={inst.name}
									art={findAvatar(inst.avatar ?? undefined) ?? null}
									scale={3}
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
								bind:this={tabEls[inst.id]}
								type="button"
								class="tab"
								class:active={inst.id === active}
								id="tab-{inst.id}"
								role="tab"
								aria-selected={inst.id === active}
								tabindex={i === focusIndex ? 0 : -1}
								onclick={() => onselect(inst.id)}
								ondblclick={() => onstartrename(inst)}
								onkeydown={onTabKeydown}
								title={inst.name}
							>
								<Avatar
									name={inst.name}
									art={findAvatar(inst.avatar ?? undefined) ?? null}
									scale={3}
								/>
								<span class="tab-name">{inst.name}</span>
								<span
									class="tab-mode"
									aria-label={inst.mode === 'terminal'
										? 'Terminal-only instance'
										: 'Full IDE instance'}
								>
									{#if inst.mode === 'terminal'}
										<Terminal size={11} />
									{:else}
										<LayoutTemplate size={11} />
									{/if}
								</span>
								<!-- The focused tab never lights up, so a lit LED always means "needs your eyes". -->
								{#if inst.id !== active && attention[inst.id]}
									<span
										class="attn {attention[inst.id]}"
										aria-label={attention[inst.id] === 'waiting'
											? 'Claude is waiting for input'
											: 'Claude finished'}
									></span>
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			</div>
			{#if overflowing}
				<button
					type="button"
					class="page trailing"
					disabled={atEnd}
					onclick={() => page(1)}
					aria-label="Scroll tabs right"><ChevronRight size={16} /></button
				>
			{/if}
		</div>
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
		background: var(--fill);
		color: var(--fill-ink);
	}

	.strip {
		display: flex;
		align-items: stretch;
		min-width: 0;
	}
	/* The native scrollbar would eat into a 44px bar, so the chevrons replace it. */
	.viewport {
		display: flex;
		min-width: 0;
		overflow-x: auto;
		scroll-behavior: smooth;
		scrollbar-width: none;
	}
	.viewport::-webkit-scrollbar {
		display: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.viewport {
			scroll-behavior: auto;
		}
	}
	.tabs {
		display: flex;
		align-items: stretch;
		flex: none;
	}

	.page {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		flex: none;
		appearance: none;
		margin: 0;
		padding: 0;
		border: 0;
		border-right: 1px solid var(--rule);
		background: var(--bg-card);
		color: var(--ink);
		cursor: pointer;
	}
	.page.trailing {
		border-right: 0;
		border-left: 1px solid var(--rule);
	}
	.page:hover:not(:disabled) {
		background: var(--fill);
		color: var(--fill-ink);
	}
	.page:disabled {
		opacity: var(--dim);
		cursor: default;
	}
	.page:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		flex: none;
		max-width: 240px;
		appearance: none;
		margin: 0;
		padding: 0 12px;
		border: 0;
		border-right: 1px solid var(--rule);
		background: transparent;
		color: var(--ink-soft);
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		/* Quantized like the instance cards — motion in this theme reads as digital. */
		transition: background 0.08s steps(2);
	}
	/* Inversion is the house hover idiom, but it's also the active state here, so hovering
	   gets a tint instead — that keeps idle → hover → active legible as three steps. */
	.tab:not(.active):hover {
		background: color-mix(in srgb, var(--ink) 12%, transparent);
		color: var(--ink);
	}
	.tab.active {
		background: var(--fill);
		color: var(--fill-ink);
		cursor: default;
		/* The key has sunk into the chassis; this strip is the slot it dropped out of. */
		box-shadow: inset 0 3px 0 var(--bg);
	}
	.tab:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}
	.tab.active:focus-visible {
		outline-color: var(--fill-ink);
	}
	.tab-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab-mode {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 18px;
		height: 18px;
		border: 1px solid currentColor;
		opacity: 0.7;
	}

	.attn {
		flex: none;
		width: 10px;
		height: 10px;
		border: 1px solid var(--edge);
		animation: tab-attn-pulse 1.4s ease-in-out infinite;
	}
	.attn.done {
		background: var(--attn-done);
		color: var(--attn-done);
	}
	.attn.waiting {
		background: var(--attn-waiting);
		color: var(--attn-waiting);
	}
	/* Redeclared rather than shared with InstanceCard — Svelte scopes keyframes per component. */
	@keyframes tab-attn-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 transparent;
			filter: brightness(0.85);
		}
		50% {
			box-shadow: 0 0 6px 2px color-mix(in srgb, currentColor 60%, transparent);
			filter: brightness(1.15);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.attn {
			animation: none;
			filter: none;
		}
	}

	.tab.editing {
		cursor: default;
	}
	.tab-name-edit {
		width: 148px;
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
		padding: 3px 6px;
		border: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
	}
	.tab-name-edit:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}
</style>
