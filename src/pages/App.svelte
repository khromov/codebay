<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import AppShell from '../components/AppShell.svelte';
	import type { Instance, InstanceFilter, Preflight } from '../types.ts';
	import type { AvatarArt } from '../avatars/index.ts';

	let {
		preflight,
		initialPath,
		snapshot,
		pet,
		filter
	}: {
		preflight: Preflight;
		initialPath: string;
		snapshot: Instance[];
		pet?: AvatarArt;
		filter: InstanceFilter;
	} = $props();
</script>

<AppShell {preflight} {initialPath} {snapshot} {pet} {filter} mochi:hydrate />
