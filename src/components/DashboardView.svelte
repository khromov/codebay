<script lang="ts">
	import {
		type Instance,
		type InstanceFilter,
		type InstanceMode,
		type Preflight
	} from '../types.ts';
	import type { AvatarArt } from '../avatars/index.ts';
	import FolderBrowser from './FolderBrowser.svelte';
	import InstanceCard from './InstanceCard.svelte';
	import TopBar from './TopBar.svelte';
	import Button from './Button.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { apiPost } from '../api.ts';

	// Presentational: AppShell owns the single live subscription both views share.
	let {
		preflight,
		instances,
		loaded,
		pet,
		filter,
		onFilter
	}: {
		preflight: Preflight;
		instances: Instance[];
		loaded: boolean;
		pet?: AvatarArt;
		filter: InstanceFilter;
		onFilter: (v: InstanceFilter) => void;
	} = $props();

	type Action = 'start' | 'stop' | 'delete' | 'rebuild';

	let browserOpen = $state(false);
	// Set only by the mode shortcut button; null lets the picker follow the global default.
	let browserMode = $state<InstanceMode | null>(null);
	let creating = $state(false);
	let actionError = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let editingName = $state('');
	// Per-instance in-flight action + the status it started from, so the busy overlay clears
	// only once the live stream reports the resulting change (avoids flicker on the round-trip).
	let pending = $state<Record<string, { action: Action; since: Instance['status'] }>>({});

	const ready = $derived(preflight.docker && preflight.cli);

	const visible = $derived(
		instances.filter((i) => {
			if (filter === 'active') return i.status === 'running' || i.status === 'creating';
			if (filter === 'stopped') return i.status === 'stopped' || i.status === 'error';
			return true;
		})
	);

	// Drop a pending entry once its instance is gone (deleted) or its status has moved on.
	$effect(() => {
		for (const [id, { since }] of Object.entries(pending)) {
			const instance = instances.find((i) => i.id === id);
			if (!instance || instance.status !== since) clearPending(id);
		}
	});

	function clearPending(id: string) {
		const { [id]: _, ...rest } = pending;
		pending = rest;
	}

	async function createFrom(
		sourcePath: string,
		opts?: { branch?: string; mode?: Instance['mode'] }
	) {
		browserOpen = false;
		creating = true;
		actionError = null;
		try {
			await apiPost(
				'/api/instances',
				{ sourcePath, branch: opts?.branch, mode: opts?.mode },
				'Failed to create instance'
			);
			// The live stream delivers the new instance.
		} catch (err) {
			actionError = (err as Error).message;
		} finally {
			creating = false;
		}
	}

	async function act(id: string, action: Action) {
		actionError = null;
		if (action === 'delete' && !confirm('Delete this instance and its copied files?')) return;
		// Rebuild discards the container; the workspace copy lives on the host and survives.
		if (
			action === 'rebuild' &&
			!confirm('Recreate this container and re-run setup? The workspace is kept.')
		)
			return;
		const since = instances.find((i) => i.id === id)?.status;
		if (since) pending = { ...pending, [id]: { action, since } };
		try {
			await apiPost(`/api/instances/${id}/${action}`, undefined, `Failed to ${action}`);
			// The live stream reflects the resulting state; the $effect clears the busy overlay.
		} catch (err) {
			actionError = (err as Error).message;
			clearPending(id);
		}
	}

	function startRename(instance: Instance) {
		editingId = instance.id;
		editingName = instance.name;
	}

	function cancelRename() {
		editingId = null;
		editingName = '';
	}

	async function commitRename(id: string) {
		const name = editingName.trim();
		const original = instances.find((i) => i.id === id)?.name;
		// Nothing to do on an empty or unchanged name — just close the editor.
		if (!name || name === original) {
			cancelRename();
			return;
		}
		cancelRename();
		actionError = null;
		try {
			await apiPost(`/api/instances/${id}/rename`, { name }, 'Failed to rename');
			// The live stream reflects the new name.
		} catch (err) {
			actionError = (err as Error).message;
		}
	}

	async function deleteAll() {
		actionError = null;
		if (!confirm(`Delete all ${instances.length} instances and their copied files?`)) return;
		try {
			await apiPost('/api/instances/delete-all', undefined, 'Failed to delete all');
			// The live stream reflects the resulting empty state.
		} catch (err) {
			actionError = (err as Error).message;
		}
	}
</script>

<TopBar
	auth={preflight.auth}
	{pet}
	canDelete={instances.length > 0}
	{ready}
	{creating}
	{filter}
	{onFilter}
	defaultMode={preflight.defaultMode}
	onNew={(mode) => {
		browserMode = mode ?? null;
		browserOpen = true;
	}}
	onDeleteAll={deleteAll}
/>

<main class="stage">
	{#if !ready}
		<div class="banner error">
			<strong>Setup needed.</strong>
			{#if !preflight.docker}<span>Docker daemon is not reachable.</span>{/if}
			{#if !preflight.cli}<span>The devcontainer CLI is not available.</span>{/if}
		</div>
	{/if}

	{#if actionError}
		<div class="banner error"><strong>Error.</strong> <span>{actionError}</span></div>
	{/if}

	{#if !loaded}
		<div class="empty"><p class="empty-sub">Loading…</p></div>
	{:else if instances.length === 0}
		<div class="empty">
			<p class="empty-title">No instances yet</p>
			<p class="empty-sub">Pick a project folder to spin up an isolated devcontainer.</p>
			<Button variant="primary" icon={Plus} onclick={() => (browserOpen = true)} disabled={!ready}>
				New instance
			</Button>
		</div>
	{:else if visible.length === 0}
		<div class="empty"><p class="empty-sub">No {filter} instances.</p></div>
	{:else}
		<ul class="grid">
			{#each visible as instance (instance.id)}
				<InstanceCard
					{instance}
					editing={editingId === instance.id}
					pending={pending[instance.id]?.action ?? null}
					bind:editingName
					onact={(action) => act(instance.id, action)}
					onstartrename={() => startRename(instance)}
					oncommitrename={() => commitRename(instance.id)}
					oncancelrename={cancelRename}
				/>
			{/each}
		</ul>
	{/if}
</main>

{#if browserOpen}
	<FolderBrowser
		onpick={createFrom}
		defaultMode={preflight.defaultMode}
		initialMode={browserMode}
		onclose={() => (browserOpen = false)}
	/>
{/if}

<style>
	.stage {
		max-width: 1080px;
		margin: 0 auto;
		padding: 28px 24px 80px;
	}
	.banner {
		padding: 12px 16px;
		margin-bottom: 20px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.banner.error {
		background: var(--bg-card);
		color: var(--ink);
		border: 2px solid var(--ink);
		box-shadow: 4px 4px 0 var(--ink);
	}
	.empty {
		text-align: center;
		padding: 80px 20px;
	}
	.empty-title {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0 0 8px;
	}
	.empty-sub {
		color: var(--ink-soft);
		margin: 0 0 22px;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 18px;
	}
</style>
