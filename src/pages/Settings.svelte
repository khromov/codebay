<script lang="ts">
	import type { AgentSettings as AgentSettingsData } from '../agents.ts';
	import '@fontsource-variable/doto';
	import '@fontsource-variable/jetbrains-mono';
	import SettingsView from '../components/SettingsView.svelte';
	import type { AvatarArt } from '../avatars/index.ts';
	import type {
		ClaudeEffortLevel,
		ClaudeOutputStyle,
		ClaudePermissionMode,
		InstanceMode
	} from '../types.ts';

	let {
		agentSettings,
		pet,
		defaultMode,
		claudePermissionMode,
		claudeEffortLevel,
		claudeOutputStyle,
		defaultImage,
		builtinImage,
		disableBuildCache,
		copyIgnorePatterns,
		builtinCopyIgnore,
		claudeConfigDir,
		mcpEnabled,
		mcpToken,
		mcpUrl,
		mcpPrAttribution,
		gitIdentityEnabled,
		gitIdentityName,
		gitIdentityEmail,
		dockerArch,
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
		customEnvVarsEnabled,
		customEnvVarNames,
		advancedSerialInjections,
		advancedNoBuildkit,
		advancedBlockingExtInstall,
		version
	}: {
		agentSettings: AgentSettingsData;
		pet?: AvatarArt;
		defaultMode: InstanceMode;
		claudePermissionMode: ClaudePermissionMode;
		claudeEffortLevel: ClaudeEffortLevel;
		claudeOutputStyle: ClaudeOutputStyle;
		defaultImage: string;
		builtinImage: string;
		disableBuildCache: boolean;
		copyIgnorePatterns: string;
		builtinCopyIgnore: string;
		claudeConfigDir: string;
		mcpEnabled: boolean;
		mcpToken: string;
		mcpUrl: string;
		mcpPrAttribution: boolean;
		gitIdentityEnabled: boolean;
		gitIdentityName: string;
		gitIdentityEmail: string;
		dockerArch: string | null;
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
		customEnvVarsEnabled: boolean;
		customEnvVarNames: string[];
		advancedSerialInjections: boolean;
		advancedNoBuildkit: boolean;
		advancedBlockingExtInstall: boolean;
		version: string;
	} = $props();
</script>

<SettingsView
	{agentSettings}
	{pet}
	{defaultMode}
	{claudePermissionMode}
	{claudeEffortLevel}
	{claudeOutputStyle}
	{defaultImage}
	{builtinImage}
	{disableBuildCache}
	{copyIgnorePatterns}
	{builtinCopyIgnore}
	{claudeConfigDir}
	{mcpEnabled}
	{mcpToken}
	{mcpUrl}
	{mcpPrAttribution}
	{gitIdentityEnabled}
	{gitIdentityName}
	{gitIdentityEmail}
	{dockerArch}
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
	{customEnvVarsEnabled}
	{customEnvVarNames}
	{advancedSerialInjections}
	{advancedNoBuildkit}
	{advancedBlockingExtInstall}
	{version}
	mochi:hydrate
/>
