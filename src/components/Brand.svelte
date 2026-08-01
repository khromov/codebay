<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import Avatar from './Avatar.svelte';
	import { getPet } from '../pet.ts';

	// Read once at init — SSR and hydration see the same cookie, so the logo can't flash.
	const pet = getPet();
</script>

<a class="brand" href="/"
	><span class="logo"
		>{#if pet}<Avatar art={pet} name={pet.name} scale={2} />{:else}<Package size={22} />{/if}</span
	><span>Codebay</span><span class="tagline">devcontainer manager</span></a
>

<style>
	.brand {
		display: inline-flex;
		align-items: baseline;
		gap: 11px;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: inherit;
		text-decoration: none;
	}
	.logo {
		display: inline-flex;
		align-items: center;
		align-self: center;
	}
	.tagline {
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	@media (max-width: 640px) {
		.tagline {
			display: none;
		}
	}
</style>
