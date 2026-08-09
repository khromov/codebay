<script lang="ts">
	import { type Instance } from '../types.ts';
	import Avatar from './Avatar.svelte';
	import BranchBox from './BranchBox.svelte';
	import PortsBox from './PortsBox.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import Button from './Button.svelte';
	import { withPopupMarker } from '../lib/popup-nav.ts';

	type Action = 'start' | 'stop' | 'delete' | 'rebuild';

	let {
		instance,
		editing,
		editingName = $bindable(),
		pending = null,
		onact,
		onstartrename,
		oncommitrename,
		oncancelrename
	}: {
		instance: Instance;
		editing: boolean;
		editingName: string;
		/** The user-triggered action currently in flight, if any — drives the busy overlay. */
		pending?: Action | null;
		onact: (action: Action) => void;
		onstartrename: () => void;
		oncommitrename: () => void;
		oncancelrename: () => void;
	} = $props();

	// Start/Stop only cycle the container; rebuild is what re-runs the injections.
	const canRebuild = $derived(
		instance.status === 'running' ||
			instance.status === 'stopped' ||
			(instance.status === 'error' && !!instance.container_id)
	);

	const BUSY_LABEL: Record<Action, string> = {
		start: 'Starting…',
		stop: 'Stopping…',
		delete: 'Deleting…',
		rebuild: 'Rebuilding…'
	};
</script>

<li class="card panel" class:busy={!!pending} aria-busy={!!pending || undefined}>
	{#if pending}
		<div class="busy-overlay" aria-live="polite">
			<span class="busy-label">{BUSY_LABEL[pending]}</span>
		</div>
	{/if}
	<div class="card-head">
		<Avatar id={instance.id} name={instance.name} interactive />
		{#if editing}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="name-edit"
				bind:value={editingName}
				autofocus
				onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
				onblur={oncommitrename}
				onkeydown={(e) => {
					if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
					else if (e.key === 'Escape') oncancelrename();
				}}
			/>
		{:else}
			<button class="name" title="Click to rename" onclick={onstartrename}>{instance.name}</button>
		{/if}
		{#if instance.attention}
			<span
				class="attn"
				class:attn-done={instance.attention === 'done'}
				class:attn-waiting={instance.attention === 'waiting'}
				title={instance.attention === 'waiting' ? 'Claude is waiting for input' : 'Claude finished'}
				aria-label={instance.attention === 'waiting'
					? 'Claude is waiting for input'
					: 'Claude finished'}
			></span>
		{/if}
		<StatusBadge status={instance.status} />
	</div>
	{#if instance.task}
		<p class="task" title={instance.task}>{instance.task}</p>
	{/if}
	<div class="path" title={instance.source_path}>{instance.source_path}</div>
	{#if instance.status === 'running'}
		<PortsBox ports={instance.forwarded_ports} />
	{/if}
	{#if instance.git_branch}
		<BranchBox branch={instance.git_branch} />
	{/if}
	{#if instance.status === 'error' && instance.error}
		<div class="card-error">{instance.error}</div>
	{/if}
	<div class="actions">
		{#if instance.status === 'running'}
			<Button variant="primary" size="sm" href={`/ide/${instance.id}`}>Open IDE</Button>
			<Button size="sm" onclick={() => onact('stop')}>Stop</Button>
		{:else if instance.status === 'stopped' || (instance.status === 'error' && instance.container_id)}
			<Button size="sm" onclick={() => onact('start')}>Start</Button>
		{:else if instance.status === 'creating'}
			<Button
				size="sm"
				href={withPopupMarker(`/instances/${instance.id}`)}
				target="_blank"
				rel="noopener noreferrer">View logs</Button
			>
		{/if}
		{#if canRebuild}
			<Button
				size="sm"
				title="Recreate the container and re-run setup (credentials, hooks, port forwards)"
				onclick={() => onact('rebuild')}>Rebuild</Button
			>
		{/if}
		<Button
			size="sm"
			ghost
			href={withPopupMarker(`/instances/${instance.id}`)}
			target="_blank"
			rel="noopener noreferrer">Details</Button
		>
		<Button variant="danger" size="sm" onclick={() => onact('delete')}>Delete</Button>
	</div>
</li>

<style>
	.card {
		position: relative;
		background: var(--bg-card);
		padding: 16px 16px 14px;
		transition:
			transform 0.08s steps(2),
			box-shadow 0.08s steps(2);
	}
	.card:hover:not(.busy) {
		transform: translate(-1px, -1px);
		box-shadow: 6px 6px 0 var(--ink);
	}
	/* Translucent scrim dims the card body and blocks clicks on the buttons beneath. */
	.busy-overlay {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--bg-card) 78%, transparent);
	}
	.busy-label {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		padding: 4px 9px;
		border: 1px solid var(--ink);
		background: var(--ink);
		color: var(--bg);
		animation: lcd-blink 1.1s steps(1) infinite;
	}
	@keyframes lcd-blink {
		50% {
			background: transparent;
			color: var(--ink);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.busy-label {
			animation: none;
		}
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.attn {
		flex: none;
		width: 14px;
		height: 14px;
		border: 1px solid var(--ink);
	}
	.attn.attn-done {
		background: var(--attn-done);
		animation: card-attn-pulse 1.4s ease-in-out infinite;
	}
	.attn.attn-waiting {
		background: var(--attn-waiting);
		animation: card-attn-pulse 1.4s ease-in-out infinite;
	}
	@keyframes card-attn-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 transparent;
			filter: brightness(0.85);
		}
		50% {
			box-shadow: 0 0 7px 2px color-mix(in srgb, currentColor 60%, transparent);
			filter: brightness(1.15);
		}
	}
	.attn.attn-done {
		color: var(--attn-done);
	}
	.attn.attn-waiting {
		color: var(--attn-waiting);
	}
	@media (prefers-reduced-motion: reduce) {
		.attn {
			animation: none;
			filter: none;
		}
	}
	.name {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 15px;
		overflow-wrap: anywhere;
		/* Reset button chrome so it reads as plain text until hovered. */
		margin: 0;
		padding: 2px 4px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.name:hover {
		border-color: var(--ink-faint);
	}
	.name-edit {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 15px;
		margin: 0;
		padding: 2px 4px;
		border: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		outline: none;
	}
	.task {
		margin: 8px 0 0;
		font-size: 13px;
		font-style: italic;
		color: var(--ink);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.task::before {
		content: open-quote;
	}
	.task::after {
		content: close-quote;
	}
	.path {
		margin-top: 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-error {
		margin-top: 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--ink);
		padding: 8px 10px;
		max-height: 80px;
		overflow: auto;
	}
	.actions {
		margin-top: 16px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
