<script lang="ts">
	import { enhance, type MochiEnhanceOptions } from 'mochi-framework';
	import Button from './Button.svelte';
	let {
		service,
		enabled,
		saved
	}: { service: 'claude' | 'github'; enabled: boolean; saved: boolean } = $props();
	let token = $state('');
	let message = $state('');
	let failed = $state(false);
	let pending = $state(false);
	const options: MochiEnhanceOptions<Record<string, unknown>, { error: string }> = {
		onPending: (value) => (pending = value),
		submit: () => {
			message = '';
			return ({ result }) => {
				failed = result.type !== 'success';
				message =
					result.type === 'failure'
						? (result.data?.error ?? 'Could not save')
						: failed
							? 'Network error. Try again.'
							: 'Saved. Applies to new and rebuilt instances.';
				if (!failed) token = '';
			};
		}
	};
</script>

<form method="POST" action="?/manualCredential" {@attach enhance(options)}>
	<input type="hidden" name="service" value={service} />
	<label class="toggle"
		><input type="checkbox" name="enabled" checked={enabled} /> Use a manual {service === 'claude'
			? 'Claude'
			: 'GitHub'} token</label
	>
	{#if service === 'claude'}
		<p>
			Run <code>claude setup-token</code> to create a long-lived token. Claude’s custom endpoint, when
			enabled, supplies its own credentials.
		</p>
	{:else}<p>Overrides host GitHub credential discovery independently of your coding agents.</p>{/if}
	<label for="{service}-manual-token">{service === 'claude' ? 'Claude Code' : 'GitHub'} token</label
	>
	<input
		id="{service}-manual-token"
		type="password"
		name="token"
		bind:value={token}
		autocomplete="new-password"
		placeholder={saved ? 'Saved — leave blank to keep' : 'Token'}
	/>
	<label class="toggle"><input type="checkbox" name="clear" /> Clear saved token</label>
	<Button type="submit" disabled={pending}>Save</Button>
	{#if message}<p class:error={failed} role="status">{message}</p>{/if}
</form>

<style>
	form {
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
		font-size: 12px;
		font-weight: 600;
	}
	p {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--ink-soft);
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	input[type='password'] {
		padding: 10px;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--rule);
		font: inherit;
	}
	.error {
		color: var(--danger);
	}
</style>
