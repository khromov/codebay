<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Component from '@lucide/svelte/icons/component';
	import Terminal from '@lucide/svelte/icons/terminal';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import { isDev } from 'mochi-framework';
	import {
		MODE_LABELS,
		type AuthProvider,
		type InstanceFilter,
		type InstanceMode
	} from '../types.ts';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
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
		secondaryMode = null,
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
		/** What the primary button creates. */
		defaultMode?: InstanceMode;
		/** What the small shortcut button creates; null hides it. */
		secondaryMode?: InstanceMode | null;
		onFilter?: (v: InstanceFilter) => void;
		onNew?: (mode?: InstanceMode) => void;
		onDeleteAll?: () => void;
	} = $props();

	// Both buttons are configured in Settings rather than derived, so "New instance" and its
	// shortcut can be any two modes — or just the one, when the shortcut is switched off.
	const MODE_ICONS = { ide: LayoutTemplate, terminal: Terminal, nono: ShieldCheck };
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
				onclick={() => onNew?.(defaultMode)}
				disabled={!ready || creating}
				title={`New ${MODE_LABELS[defaultMode].toLowerCase()} instance`}
			>
				{creating ? 'Creating…' : 'New instance'}
			</Button>
			{#if secondaryMode}
				<Button
					variant="primary"
					size="sm"
					square
					icon={MODE_ICONS[secondaryMode]}
					iconSize={15}
					onclick={() => onNew?.(secondaryMode)}
					disabled={!ready || creating}
					title={`New ${MODE_LABELS[secondaryMode].toLowerCase()} instance`}
					aria-label={`New ${MODE_LABELS[secondaryMode].toLowerCase()} instance`}
				/>
			{/if}
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
