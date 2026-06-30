<script lang="ts">
  import '@fontsource-variable/doto';
  import '@fontsource-variable/jetbrains-mono';
  import SettingsView from '../components/SettingsView.svelte';

  let {
    defaultImage,
    builtinImage,
    dockerArch,
  }: { defaultImage: string; builtinImage: string; dockerArch: string | null } = $props();
</script>

<SettingsView {defaultImage} {builtinImage} {dockerArch} mochi:hydrate />
