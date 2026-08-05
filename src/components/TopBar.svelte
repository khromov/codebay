<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Component from '@lucide/svelte/icons/component';
	import { isDev } from 'mochi-framework';
	import type { AuthProvider, InstanceFilter } from '../types.ts';
	import type { AvatarArt } from '../avatars/index.ts';
	import Brand from './Brand.svelte';
	import InstanceFilterControl from './InstanceFilter.svelte';
	import SettingsCog from './SettingsCog.svelte';
	import CredMenu from './CredMenu.svelte';
	import Button from './Button.svelte';

	// Action state is injected so the bar stays presentational and reusable on /debug.
	let {
		auth,
		pet,
		canDelete = false,
		ready = true,
		creating = false,
		filter,
		onFilter,
		onNew,
		onDeleteAll
	}: {
		auth: AuthProvider[];
		pet?: AvatarArt;
		canDelete?: boolean;
		ready?: boolean;
		creating?: boolean;
		filter?: InstanceFilter;
		onFilter?: (v: InstanceFilter) => void;
		onNew?: () => void;
		onDeleteAll?: () => void;
	} = $props();
</script>

<header class="topbar">
	<Brand {pet} />
	<div class="topbar-actions">
		{#if isDev}
			<Button variant="default" size="sm" icon={Component} href="/debug">Debug</Button>
		{/if}
		{#if filter && onFilter}
			<InstanceFilterControl value={filter} onchange={onFilter} />
		{/if}
		<SettingsCog />
		<CredMenu {auth} />
		<Button variant="danger" size="sm" onclick={onDeleteAll} disabled={!canDelete}>
			Delete all
		</Button>
		<Button
			variant="primary"
			icon={creating ? undefined : Plus}
			onclick={onNew}
			disabled={!ready || creating}
		>
			{creating ? 'Creating…' : 'New instance'}
		</Button>
	</div>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 28px;
		border-bottom: 1px solid var(--rule);
	}
	.topbar-actions {
		display: inline-flex;
		align-items: center;
		gap: 14px;
	}
</style>
