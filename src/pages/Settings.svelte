<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import SettingsView from '../components/SettingsView.svelte';

	let {
		defaultImage,
		builtinImage,
		disableBuildCache,
		dockerArch
	}: {
		defaultImage: string;
		builtinImage: string;
		disableBuildCache: boolean;
		dockerArch: string | null;
	} = $props();
</script>

<SettingsView {defaultImage} {builtinImage} {disableBuildCache} {dockerArch} mochi:hydrate />
