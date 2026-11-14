<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import InstanceView from '../components/InstanceView.svelte';

	let {
		id,
		injectionChecks,
		uploadEnabled
	}: { id: string; injectionChecks: number; uploadEnabled: boolean } = $props();
</script>

<InstanceView {id} {injectionChecks} {uploadEnabled} mochi:hydrate />
