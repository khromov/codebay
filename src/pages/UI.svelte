<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import type { Preflight } from '../types.ts';
	import UiShowcase from '../components/UiShowcase.svelte';

	let { preflight }: { preflight: Preflight } = $props();
</script>

<UiShowcase {preflight} mochi:hydrate />
