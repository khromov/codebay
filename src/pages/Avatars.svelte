<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import AvatarsView from '../components/AvatarsView.svelte';

	let { namePlaceholder }: { namePlaceholder: string } = $props();
</script>

<AvatarsView {namePlaceholder} mochi:hydrate />
