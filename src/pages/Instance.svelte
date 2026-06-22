<script lang="ts">
  import '@fontsource-variable/fraunces';
  import '@fontsource-variable/public-sans';
  import '@fontsource-variable/jetbrains-mono';
  import InstanceView from '../components/InstanceView.svelte';

  let { id }: { id: string } = $props();
</script>

<InstanceView {id} mochi:hydrate />
