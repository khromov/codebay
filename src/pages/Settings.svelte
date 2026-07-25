<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import SettingsView from '../components/SettingsView.svelte';

	let {
		defaultImage,
		builtinImage,
		disableBuildCache,
		dockerArch,
		manualTokensEnabled,
		githubTokenSet,
		claudeTokenSet,
		openaiApiKeySet,
		claudeEnabled,
		codexEnabled,
		customEndpointEnabled,
		customEndpointBaseUrl,
		customEndpointTokenSet,
		customEndpointOpusModel,
		customEndpointSonnetModel,
		customEndpointHaikuModel,
		customEndpointSmallFastModel,
		customEndpointModel,
		hostEnvVarsEnabled,
		hostEnvVarNames,
		hostEnvVarPresence
	}: {
		defaultImage: string;
		builtinImage: string;
		disableBuildCache: boolean;
		dockerArch: string | null;
		manualTokensEnabled: boolean;
		githubTokenSet: boolean;
		claudeTokenSet: boolean;
		openaiApiKeySet: boolean;
		claudeEnabled: boolean;
		codexEnabled: boolean;
		customEndpointEnabled: boolean;
		customEndpointBaseUrl: string;
		customEndpointTokenSet: boolean;
		customEndpointOpusModel: string;
		customEndpointSonnetModel: string;
		customEndpointHaikuModel: string;
		customEndpointSmallFastModel: string;
		customEndpointModel: string;
		hostEnvVarsEnabled: boolean;
		hostEnvVarNames: string[];
		hostEnvVarPresence: Record<string, boolean>;
	} = $props();
</script>

<SettingsView
	{defaultImage}
	{builtinImage}
	{disableBuildCache}
	{dockerArch}
	{manualTokensEnabled}
	{githubTokenSet}
	{claudeTokenSet}
	{openaiApiKeySet}
	{claudeEnabled}
	{codexEnabled}
	{customEndpointEnabled}
	{customEndpointBaseUrl}
	{customEndpointTokenSet}
	{customEndpointOpusModel}
	{customEndpointSonnetModel}
	{customEndpointHaikuModel}
	{customEndpointSmallFastModel}
	{customEndpointModel}
	{hostEnvVarsEnabled}
	{hostEnvVarNames}
	{hostEnvVarPresence}
	mochi:hydrate
/>
