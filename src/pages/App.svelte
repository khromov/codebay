<script lang="ts">
  import '@fontsource-variable/doto';
  import '@fontsource-variable/jetbrains-mono';
  import AppShell from '../components/AppShell.svelte';
  import type { Instance, Preflight } from '../types.ts';

  let {
    preflight,
    initialPath,
    snapshot,
  }: { preflight: Preflight; initialPath: string; snapshot: Instance[] } = $props();
</script>

<AppShell {preflight} {initialPath} {snapshot} mochi:hydrate />
