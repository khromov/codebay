<script lang="ts">
	import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
	import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
	import TerminalPane from './TerminalPane.svelte';
	import { apiPost } from '../api.ts';

	let {
		id,
		active,
		initialOpen = false
	}: { id: string; active: boolean; initialOpen?: boolean } = $props();

	// Seeding from the persisted flag is intentional — from here on the toggle owns the state.
	// svelte-ignore state_referenced_locally
	let open = $state(initialOpen);
	// Once mounted the shell pane is only ever hidden, never torn down, so its xterm buffer and
	// socket survive a close/reopen.
	// svelte-ignore state_referenced_locally
	let mounted = $state(initialOpen);
	let ratio = $state(50);
	let focusSide = $state<'left' | 'right'>('left');
	let container: HTMLDivElement;

	function toggle() {
		open = !open;
		if (open) mounted = true;
		focusSide = open ? 'right' : 'left';
		// Best-effort: a failed write only costs the restore-on-reload, never the split itself.
		void apiPost(`/api/instances/${id}/split`, { open }).catch(() => {});
	}

	function clamp(pct: number): number {
		return Math.min(80, Math.max(20, pct));
	}

	function dragTo(clientX: number) {
		const rect = container.getBoundingClientRect();
		if (rect.width > 0) ratio = clamp(((clientX - rect.left) / rect.width) * 100);
	}

	function onDividerDown(e: PointerEvent) {
		e.preventDefault(); // or the drag selects terminal text instead
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onDividerMove(e: PointerEvent) {
		if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) dragTo(e.clientX);
	}

	function onDividerKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') ratio = clamp(ratio - 5);
		else if (e.key === 'ArrowRight') ratio = clamp(ratio + 5);
		else return;
		e.preventDefault();
	}
</script>

{#snippet splitToggle()}
	<button
		type="button"
		onclick={toggle}
		aria-pressed={open}
		title={open ? 'Hide the shell pane' : 'Open a shell alongside Claude'}
		aria-label={open ? 'Hide the shell pane' : 'Open a shell alongside Claude'}
	>
		{#if open}<PanelRightClose size={14} />{:else}<PanelRightOpen size={14} />{/if}
	</button>
{/snippet}

<div class="split" bind:this={container}>
	<!-- Clicking a terminal focuses it anyway; capture that so tab switches restore the same side. -->
	<div
		class="side"
		style:flex-basis={open ? `${ratio}%` : '100%'}
		onpointerdowncapture={() => (focusSide = 'left')}
	>
		<TerminalPane
			{id}
			{active}
			focus={active && focusSide === 'left'}
			actions={open ? undefined : splitToggle}
		/>
	</div>
	{#if mounted}
		<!-- A focusable separator is the ARIA window-splitter pattern; the rule doesn't model it. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="divider"
			class:hidden={!open}
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize terminal panes"
			aria-valuenow={Math.round(ratio)}
			aria-valuemin={20}
			aria-valuemax={80}
			tabindex="0"
			onpointerdown={onDividerDown}
			onpointermove={onDividerMove}
			ondblclick={() => (ratio = 50)}
			onkeydown={onDividerKey}
		></div>
		<div
			class="side"
			class:hidden={!open}
			style:flex-basis="{100 - ratio}%"
			onpointerdowncapture={() => (focusSide = 'right')}
		>
			<TerminalPane
				{id}
				arg="shell"
				active={active && open}
				focus={active && open && focusSide === 'right'}
				actions={open ? splitToggle : undefined}
			/>
		</div>
	{/if}
</div>

<style>
	.split {
		display: flex;
		width: 100%;
		height: 100%;
	}
	/* Positioned so each pane's absolute overlay anchors to its own half, not the whole split. */
	.side {
		position: relative;
		/* No grow: the two flex-basis percentages are the split, the divider eats the rounding. */
		flex: 0 1 auto;
		min-width: 0;
	}
	.side.hidden {
		display: none;
	}
	.divider {
		flex: none;
		width: 7px;
		margin: 0 -3px; /* a wider grab target than the 1px rule it draws */
		cursor: col-resize;
		background: var(--rule);
		background-clip: content-box;
		border-left: 3px solid transparent;
		border-right: 3px solid transparent;
		z-index: 1;
	}
	.divider.hidden {
		display: none;
	}
	.divider:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}
</style>
