<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import Avatar from './Avatar.svelte';
	import type { AvatarArt } from '../avatars/index.ts';

	// Resolved server-side and threaded through props, so SSR and hydration agree and the logo can't flash.
	let { pet }: { pet?: AvatarArt } = $props();
</script>

<a class="brand" href="/"
	><span class="logo"
		>{#if pet}<Avatar art={pet} name={pet.name} scale={4} />{:else}<Package size={22} />{/if}</span
	><span class="words"><span>Codebay</span><span class="tagline">devcontainer manager</span></span
	></a
>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
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
	}
	/* Keep the wordmark and tagline on a shared baseline, but center the group against the logo. */
	.words {
		display: inline-flex;
		align-items: baseline;
		gap: 11px;
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
