<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Component from '@lucide/svelte/icons/component';
	import Terminal from '@lucide/svelte/icons/terminal';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import { isDev } from 'mochi-framework';
	import type { AuthProvider, InstanceFilter, InstanceMode } from '../types.ts';
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
		defaultMode = 'ide',
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
		/** Drives the shortcut button, which always offers the mode the main button won't create. */
		defaultMode?: InstanceMode;
		onFilter?: (v: InstanceFilter) => void;
		onNew?: (mode?: InstanceMode) => void;
		onDeleteAll?: () => void;
	} = $props();

	const altMode = $derived<InstanceMode>(defaultMode === 'terminal' ? 'ide' : 'terminal');
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
		<div class="new-group">
			<Button
				variant="primary"
				size="sm"
				icon={creating ? undefined : Plus}
				onclick={() => onNew?.()}
				disabled={!ready || creating}
			>
				{creating ? 'Creating…' : 'New instance'}
			</Button>
			<Button
				variant="primary"
				size="sm"
				square
				icon={altMode === 'terminal' ? Terminal : LayoutTemplate}
				iconSize={15}
				onclick={() => onNew?.(altMode)}
				disabled={!ready || creating}
				title={altMode === 'terminal' ? 'New terminal instance' : 'New full IDE instance'}
				aria-label={altMode === 'terminal' ? 'New terminal instance' : 'New full IDE instance'}
			/>
		</div>
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
	/* The mode shortcut reads as part of the New instance control, not a separate action. */
	.new-group {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
