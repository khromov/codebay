<script lang="ts">
  import '@fontsource-variable/doto';
  import '@fontsource-variable/jetbrains-mono';
  import InstanceView from '../components/InstanceView.svelte';

  let { id, injectionChecks }: { id: string; injectionChecks: number } = $props();
</script>

<InstanceView {id} {injectionChecks} mochi:hydrate />
