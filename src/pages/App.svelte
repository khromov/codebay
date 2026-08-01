<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import AppShell from '../components/AppShell.svelte';
	import type { Instance, Preflight } from '../types.ts';
	import type { AvatarArt } from '../avatars/index.ts';

	let {
		preflight,
		initialPath,
		snapshot,
		pet
	}: {
		preflight: Preflight;
		initialPath: string;
		snapshot: Instance[];
		pet?: AvatarArt;
	} = $props();
</script>

<AppShell {preflight} {initialPath} {snapshot} {pet} mochi:hydrate />
