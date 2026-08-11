<script lang="ts">
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import SettingsView from '../components/SettingsView.svelte';
	import type { AvatarArt } from '../avatars/index.ts';
	import type { ClaudePermissionMode, InstanceMode } from '../types.ts';

	let {
		pet,
		defaultMode,
		secondaryMode,
		resolvedSecondaryMode,
		enabledModes,
		allModes,
		modeLabels,
		nonoAvailable,
		nonoProfile,
		builtinNonoProfile,
		claudePermissionMode,
		defaultImage,
		builtinImage,
		disableBuildCache,
		copyIgnorePatterns,
		builtinCopyIgnore,
		gitIdentityEnabled,
		gitIdentityName,
		gitIdentityEmail,
		dockerArch,
		manualTokensEnabled,
		githubTokenSet,
		claudeTokenSet,
		customEndpointEnabled,
		customEndpointBaseUrl,
		customEndpointTokenSet,
		customEndpointOpusModel,
		customEndpointSonnetModel,
		customEndpointHaikuModel,
		customEndpointSmallFastModel,
		customEndpointModel,
		manualModelOverrideEnabled,
		manualOpusModel,
		manualSonnetModel,
		manualHaikuModel,
		manualSmallFastModel,
		manualModel,
		hostEnvVarsEnabled,
		hostEnvVarNames,
		hostEnvVarPresence,
		advancedSerialInjections,
		advancedNoBuildkit,
		advancedBlockingExtInstall,
		version
	}: {
		pet?: AvatarArt;
		defaultMode: InstanceMode;
		secondaryMode: string;
		resolvedSecondaryMode: InstanceMode | null;
		enabledModes: InstanceMode[];
		allModes: InstanceMode[];
		modeLabels: Record<InstanceMode, string>;
		nonoAvailable: boolean;
		nonoProfile: string;
		builtinNonoProfile: string;
		claudePermissionMode: ClaudePermissionMode;
		defaultImage: string;
		builtinImage: string;
		disableBuildCache: boolean;
		copyIgnorePatterns: string;
		builtinCopyIgnore: string;
		gitIdentityEnabled: boolean;
		gitIdentityName: string;
		gitIdentityEmail: string;
		dockerArch: string | null;
		manualTokensEnabled: boolean;
		githubTokenSet: boolean;
		claudeTokenSet: boolean;
		customEndpointEnabled: boolean;
		customEndpointBaseUrl: string;
		customEndpointTokenSet: boolean;
		customEndpointOpusModel: string;
		customEndpointSonnetModel: string;
		customEndpointHaikuModel: string;
		customEndpointSmallFastModel: string;
		customEndpointModel: string;
		manualModelOverrideEnabled: boolean;
		manualOpusModel: string;
		manualSonnetModel: string;
		manualHaikuModel: string;
		manualSmallFastModel: string;
		manualModel: string;
		hostEnvVarsEnabled: boolean;
		hostEnvVarNames: string[];
		hostEnvVarPresence: Record<string, boolean>;
		advancedSerialInjections: boolean;
		advancedNoBuildkit: boolean;
		advancedBlockingExtInstall: boolean;
		version: string;
	} = $props();
</script>

<SettingsView
	{pet}
	{defaultMode}
	{secondaryMode}
	{resolvedSecondaryMode}
	{enabledModes}
	{allModes}
	{modeLabels}
	{nonoAvailable}
	{nonoProfile}
	{builtinNonoProfile}
	{claudePermissionMode}
	{defaultImage}
	{builtinImage}
	{disableBuildCache}
	{copyIgnorePatterns}
	{builtinCopyIgnore}
	{gitIdentityEnabled}
	{gitIdentityName}
	{gitIdentityEmail}
	{dockerArch}
	{manualTokensEnabled}
	{githubTokenSet}
	{claudeTokenSet}
	{customEndpointEnabled}
	{customEndpointBaseUrl}
	{customEndpointTokenSet}
	{customEndpointOpusModel}
	{customEndpointSonnetModel}
	{customEndpointHaikuModel}
	{customEndpointSmallFastModel}
	{customEndpointModel}
	{manualModelOverrideEnabled}
	{manualOpusModel}
	{manualSonnetModel}
	{manualHaikuModel}
	{manualSmallFastModel}
	{manualModel}
	{hostEnvVarsEnabled}
	{hostEnvVarNames}
	{hostEnvVarPresence}
	{advancedSerialInjections}
	{advancedNoBuildkit}
	{advancedBlockingExtInstall}
	{version}
	mochi:hydrate
/>
