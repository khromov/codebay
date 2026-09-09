<script lang="ts">
	import { enhance, type MochiEnhanceOptions } from 'mochi-framework';
	import {
		CODEX_PERMISSION_MODES,
		CODEX_EFFORT_LEVELS,
		CODEX_VERBOSITIES,
		type AgentSettings
	} from '../agents.ts';
	import Button from './Button.svelte';
	let { settings, section }: { settings: AgentSettings; section: 'selection' | 'codex' } = $props();
	let message = $state('');
	let failed = $state(false);
	let pending = $state(false);
	let key = $state('');
	const options: MochiEnhanceOptions<Record<string, unknown>, { error: string }> = {
		onPending: (value) => (pending = value),
		submit: () => {
			message = '';
			return ({ result }) => {
				failed = result.type !== 'success';
				message =
					result.type === 'failure'
						? (result.data?.error ?? 'Could not save settings')
						: failed
							? 'Network error. Try again.'
							: 'Saved. Applies to new and rebuilt instances.';
				if (!failed) key = '';
			};
		}
	};
</script>

<form
	class="agent-settings"
	method="POST"
	action={section === 'selection' ? '?/agentSelection' : '?/codexSettings'}
	{@attach enhance(options)}
>
	{#if section === 'selection'}
		<label for="agent-selection">Available agents</label>
		<p>
			Claude is enabled by default. With both enabled, each sandbox installs both agents and
			launches the one you choose when creating it. Open another console to run the other agent
			manually.
		</p>
		<select id="agent-selection" name="selection" value={settings.selection}>
			<option value="claude">Claude (default)</option><option value="codex">Codex</option><option
				value="both">Claude and Codex</option
			>
		</select>
		<p>Existing containers keep their installed agents until rebuilt.</p>
	{:else}
		<label for="codex-dir">Host config directory</label>
		<input
			id="codex-dir"
			name="configDir"
			value={settings.codexConfigDir}
			placeholder="CODEX_HOME or ~/.codex"
		/>
		<p>
			Imports your host login, model and display preferences, AGENTS.md, rules and skills. User
			skills in ~/.agents/skills are also included. Host files are never modified.
		</p>
		<label for="codex-key">OpenAI API key</label>
		<input
			id="codex-key"
			name="apiKey"
			type="password"
			bind:value={key}
			autocomplete="new-password"
			placeholder={settings.codexKeySet
				? 'Saved — leave blank to keep'
				: 'Optional — defaults to host login'}
		/>
		<label class="check"><input type="checkbox" name="clearKey" /> Clear saved API key</label>
		<p>
			A saved key overrides environment credentials and host login. Without an exportable host
			login, run <code>codex login --device-auth</code> inside the container.
		</p>
		<label for="codex-permissions">Permissions</label>
		<select id="codex-permissions" name="permissionMode" value={settings.codexPermissionMode}>
			{#each CODEX_PERMISSION_MODES as mode (mode)}<option value={mode}
					>{mode === 'full-access'
						? 'Full access (container isolation)'
						: mode === 'workspace'
							? 'Workspace writes, ask for broader access'
							: 'Read only, ask for writes'}</option
				>{/each}
		</select>
		<label for="codex-model">Model</label>
		<input
			id="codex-model"
			name="model"
			value={settings.codexModel}
			placeholder="Inherit host or Codex default"
		/>
		<label for="codex-effort">Reasoning effort</label>
		<select id="codex-effort" name="effort" value={settings.codexEffort}
			>{#each CODEX_EFFORT_LEVELS as effort (effort)}<option value={effort}
					>{effort === 'default' ? 'Inherit host or model default' : effort}</option
				>{/each}</select
		>
		<label for="codex-verbosity">Response verbosity</label>
		<select id="codex-verbosity" name="verbosity" value={settings.codexVerbosity}
			>{#each CODEX_VERBOSITIES as level (level)}<option value={level}
					>{level === 'default' ? 'Inherit host or model default' : level}</option
				>{/each}</select
		>
		<p>
			Reasoning effort and verbosity depend on the selected model. Codex inherits the host’s native
			status line.
		</p>
		<label class="check"
			><input type="checkbox" name="endpointEnabled" checked={settings.codexEndpointEnabled} /> Use a
			custom Responses API endpoint</label
		>
		<label for="codex-endpoint">Base URL</label>
		<input
			id="codex-endpoint"
			name="baseUrl"
			value={settings.codexBaseUrl}
			placeholder="https://your-proxy.example/v1"
		/>
		<p>
			Uses the API key above and the model ID you specify. This is independent of Claude’s
			LiteLLM/Bedrock settings.
		</p>
	{/if}
	<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
	{#if message}<p class:error={failed} role="status">{message}</p>{/if}
</form>

<style>
	.agent-settings {
		width: 100%;
		max-width: 560px;
		box-sizing: border-box;
		margin: 0 auto 16px;
		border: 1px solid var(--rule);
		background: var(--bg-card);
		padding: 22px;
		display: grid;
		gap: 12px;
	}
	label {
		font-weight: 600;
	}
	p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 12px;
		line-height: 1.6;
	}
	input:not([type='checkbox']),
	select {
		width: 100%;
		box-sizing: border-box;
		min-height: 38px;
		padding: 8px 10px;
		font: inherit;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--rule);
	}
	.check {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 12px;
	}
	.error {
		color: var(--danger);
	}
</style>
