<script lang="ts">
  import '@fontsource-variable/fraunces';
  import '@fontsource-variable/public-sans';
  import '@fontsource-variable/jetbrains-mono';
  import type { Preflight } from '../types.ts';
  import DashboardApp from '../components/DashboardApp.svelte';

  let { preflight }: { preflight: Preflight } = $props();
</script>

<DashboardApp {preflight} mochi:hydrate />
