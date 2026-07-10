<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Component from '@lucide/svelte/icons/component';
	import { isDev } from 'mochi-framework';
	import type { AuthProvider } from '../types.ts';
	import Brand from './Brand.svelte';
	import SettingsCog from './SettingsCog.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import CredMenu from './CredMenu.svelte';
	import Button from './Button.svelte';

	// The app's top bar: branding plus the credentials/settings/actions cluster.
	// Action state is injected so the bar stays presentational (and reusable on
	// the dev /debug showcase).
	let {
		auth,
		canDelete = false,
		ready = true,
		creating = false,
		onNew,
		onDeleteAll
	}: {
		auth: AuthProvider[];
		canDelete?: boolean;
		ready?: boolean;
		creating?: boolean;
		onNew?: () => void;
		onDeleteAll?: () => void;
	} = $props();
</script>

<header class="topbar">
	<Brand />
	<div class="topbar-actions">
		{#if isDev}
			<Button variant="default" size="sm" icon={Component} href="/debug">Debug</Button>
		{/if}
		<ThemeToggle />
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
