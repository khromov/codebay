<script lang="ts">
	import Container from '@lucide/svelte/icons/container';
	import AppBar from './AppBar.svelte';
	import Power from '@lucide/svelte/icons/power';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import SunMoon from '@lucide/svelte/icons/sun-moon';
	import ThemePicker from './ThemePicker.svelte';
	import Layers from '@lucide/svelte/icons/layers';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Hammer from '@lucide/svelte/icons/hammer';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Variable from '@lucide/svelte/icons/variable';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Toaster } from 'svelte-french-toast';
	import { flushSync } from 'svelte';
	import { enhance } from 'mochi-framework';
	import type { MochiEnhanceOptions } from 'mochi-framework';
	import { soundEnabled, setSoundEnabled } from '../settings.ts';
	import { playChime, unlockAudio } from '../sound.ts';
	import Button from './Button.svelte';
	import CoinButton from './CoinButton.svelte';
	import AvatarEditor from './AvatarEditor.svelte';

	/** Every settings form action fails with the same `{ error }` shape. */
	type ActionFailure = { error: string };

	let {
		defaultImage,
		builtinImage,
		disableBuildCache,
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

	// Initialize from localStorage on the client; defaults to on during SSR.
	let sound = $state(soundEnabled());

	let shuttingDown = $state(false);

	/**
	 * `enhance` options for a "save this form" control: `onPending` drives the
	 * saving flag, the submit callback clears any previous error/message (an
	 * optional confirm() gate can `cancel()` before that), and the result
	 * callback routes to `onSuccess` / a generic error message. Reused by every
	 * plain save/action form below — only the per-control state setters differ.
	 */
	function saveOpts<Success extends Record<string, unknown> = Record<string, unknown>>(handlers: {
		setSaving: (v: boolean) => void;
		setError: (v: string | null) => void;
		setMsg?: (v: string | null) => void;
		onSuccess: (data: Success | undefined) => void;
		confirmMessage?: string;
	}): MochiEnhanceOptions<Success, ActionFailure> {
		return {
			onPending: handlers.setSaving,
			submit: ({ cancel }) => {
				if (handlers.confirmMessage && !confirm(handlers.confirmMessage)) {
					cancel();
					return;
				}
				handlers.setError(null);
				handlers.setMsg?.(null);
				return ({ result }) => {
					if (result.type === 'success') {
						handlers.onSuccess(result.data);
					} else if (result.type === 'failure') {
						handlers.setError(result.data?.error ?? 'Request failed');
					} else if (result.type === 'error') {
						handlers.setError('Network error. Try again.');
					}
				};
			}
		};
	}

	/**
	 * `enhance` options for a checkbox toggle form. The checkbox's own `onchange`
	 * flips the bound state and calls `form.requestSubmit()` — by the time the
	 * submit fires, the DOM (and thus `formData`) already reflects the new
	 * "checked" value, so that optimistic flip is free. On failure/error, revert
	 * to the opposite of what was submitted.
	 */
	function toggleOpts<Success extends Record<string, unknown> = Record<string, unknown>>(handlers: {
		set: (v: boolean) => void;
		setSaving: (v: boolean) => void;
		setError: (v: string | null) => void;
		onSuccess?: (data: Success | undefined) => void;
	}): MochiEnhanceOptions<Success, ActionFailure> {
		return {
			onPending: handlers.setSaving,
			submit: ({ formData }) => {
				const intended = formData.get('enabled') === 'on';
				handlers.setError(null);
				return ({ result }) => {
					if (result.type === 'success') {
						handlers.onSuccess?.(result.data);
						return;
					}
					handlers.set(!intended);
					handlers.setError(
						result.type === 'failure'
							? (result.data?.error ?? 'Request failed')
							: 'Network error. Try again.'
					);
				};
			}
		};
	}

	// svelte-ignore state_referenced_locally
	let image = $state(defaultImage);
	let savingImage = $state(false);
	let imageError = $state<string | null>(null);
	let imageSaved = $state(false);
	let imageFormEl: HTMLFormElement | undefined;

	const imageOpts = saveOpts<{ image: string }>({
		setSaving: (v) => (savingImage = v),
		setError: (v) => (imageError = v),
		setMsg: (v) => (imageSaved = !!v),
		onSuccess: (data) => {
			image = data?.image ?? image;
			imageSaved = true;
		}
	});

	// Restore the built-in default image and persist it — same form, same action;
	// setting the bound value then resubmitting keeps this a one-form control.
	function resetImage() {
		// flushSync forces the bind:value DOM update to happen before requestSubmit
		// reads the input's value via FormData — otherwise it would submit the stale value.
		flushSync(() => (image = builtinImage));
		imageFormEl?.requestSubmit();
	}

	// Build cache — the DB-backed "disable cache" flag is the source of truth (unlike
	// the localStorage sound toggle), so initialize from the prop and persist on change.
	// svelte-ignore state_referenced_locally
	let noCache = $state(disableBuildCache);
	let savingCache = $state(false);
	let cacheError = $state<string | null>(null);

	const buildCacheToggleOpts = toggleOpts({
		set: (v) => (noCache = v),
		setSaving: (v) => (savingCache = v),
		setError: (v) => (cacheError = v)
	});

	let clearing = $state(false);
	let clearMsg = $state<string | null>(null);
	let clearError = $state<string | null>(null);

	function formatBytes(n: number): string {
		if (n <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
		return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	const clearCacheOpts = saveOpts<{ spaceReclaimed: number }>({
		setSaving: (v) => (clearing = v),
		setError: (v) => (clearError = v),
		setMsg: (v) => (clearMsg = v),
		onSuccess: (data) => {
			clearMsg = `Cleared — freed ${formatBytes(data?.spaceReclaimed ?? 0)}.`;
		}
	});

	let rebuilding = $state(false);
	let rebuildMsg = $state<string | null>(null);
	let rebuildError = $state<string | null>(null);

	const rebuildAllOpts = saveOpts<{ count: number }>({
		setSaving: (v) => (rebuilding = v),
		setError: (v) => (rebuildError = v),
		setMsg: (v) => (rebuildMsg = v),
		confirmMessage:
			'Rebuild every running container from scratch (no build cache)? Each will restart and may take a while.',
		onSuccess: (data) => {
			const n = data?.count ?? 0;
			rebuildMsg = n === 0 ? 'No running containers to rebuild.' : `Rebuilding ${n} container(s)…`;
		}
	});

	// Manual credential tokens. The DB is the source of truth; initialize the toggle
	// from the prop. Token values are never sent to the client — we only know whether
	// each is already set (to show a "saved" placeholder) and never render the secret.
	// svelte-ignore state_referenced_locally
	let manualTokens = $state(manualTokensEnabled);
	let savingManualToggle = $state(false);
	let manualToggleError = $state<string | null>(null);

	const manualTokensToggleOpts = toggleOpts({
		set: (v) => (manualTokens = v),
		setSaving: (v) => (savingManualToggle = v),
		setError: (v) => (manualToggleError = v)
	});

	// svelte-ignore state_referenced_locally
	let ghSaved = $state(githubTokenSet);
	let githubToken = $state('');
	let savingGithub = $state(false);
	let githubMsg = $state<string | null>(null);
	let githubError = $state<string | null>(null);

	const githubTokenOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingGithub = v),
		setError: (v) => (githubError = v),
		setMsg: (v) => (githubMsg = v),
		onSuccess: (data) => {
			ghSaved = data?.set ?? false;
			githubToken = '';
			githubMsg = ghSaved ? 'Saved.' : 'Cleared.';
		}
	});

	// svelte-ignore state_referenced_locally
	let claudeSaved = $state(claudeTokenSet);
	let claudeToken = $state('');
	let savingClaude = $state(false);
	let claudeMsg = $state<string | null>(null);
	let claudeError = $state<string | null>(null);

	const claudeTokenOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingClaude = v),
		setError: (v) => (claudeError = v),
		setMsg: (v) => (claudeMsg = v),
		onSuccess: (data) => {
			claudeSaved = data?.set ?? false;
			claudeToken = '';
			claudeMsg = claudeSaved ? 'Saved.' : 'Cleared.';
		}
	});

	// Custom endpoint (LiteLLM / Bedrock). Like manual tokens: the toggle persists
	// to the DB; each field saves individually via its own form. The token value
	// is never returned to the client — we only know whether it was set.
	// svelte-ignore state_referenced_locally
	let customEndpoint = $state(customEndpointEnabled);
	let savingCustomToggle = $state(false);
	let customToggleError = $state<string | null>(null);

	const customEndpointToggleOpts = toggleOpts({
		set: (v) => (customEndpoint = v),
		setSaving: (v) => (savingCustomToggle = v),
		setError: (v) => (customToggleError = v)
	});

	// svelte-ignore state_referenced_locally
	let customBaseUrl = $state(customEndpointBaseUrl);
	let savingCustomBaseUrl = $state(false);
	let customBaseUrlMsg = $state<string | null>(null);
	let customBaseUrlError = $state<string | null>(null);

	const customBaseUrlOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingCustomBaseUrl = v),
		setError: (v) => (customBaseUrlError = v),
		setMsg: (v) => (customBaseUrlMsg = v),
		onSuccess: (data) => {
			customBaseUrlMsg = data?.set ? 'Saved.' : 'Cleared.';
		}
	});

	let customToken = $state('');
	// svelte-ignore state_referenced_locally
	let customTokenSaved = $state(customEndpointTokenSet);
	let savingCustomToken = $state(false);
	let customTokenMsg = $state<string | null>(null);
	let customTokenError = $state<string | null>(null);

	const customTokenOpts = saveOpts<{ set: boolean }>({
		setSaving: (v) => (savingCustomToken = v),
		setError: (v) => (customTokenError = v),
		setMsg: (v) => (customTokenMsg = v),
		onSuccess: (data) => {
			customTokenSaved = data?.set ?? false;
			customToken = '';
			customTokenMsg = customTokenSaved ? 'Saved.' : 'Cleared.';
		}
	});

	// svelte-ignore state_referenced_locally
	let customOpusModel = $state(customEndpointOpusModel);
	// svelte-ignore state_referenced_locally
	let customSonnetModel = $state(customEndpointSonnetModel);
	// svelte-ignore state_referenced_locally
	let customHaikuModel = $state(customEndpointHaikuModel);
	// svelte-ignore state_referenced_locally
	let customSmallFastModel = $state(customEndpointSmallFastModel);
	// svelte-ignore state_referenced_locally
	let customDefaultModel = $state(customEndpointModel);
	let savingCustomModels = $state(false);
	let customModelsMsg = $state<string | null>(null);
	let customModelsError = $state<string | null>(null);

	const customModelsOpts = saveOpts({
		setSaving: (v) => (savingCustomModels = v),
		setError: (v) => (customModelsError = v),
		setMsg: (v) => (customModelsMsg = v),
		onSuccess: () => {
			customModelsMsg = 'Saved.';
		}
	});

	// Host env vars forwarded into containers. Only *names* round-trip with the
	// server — values are never sent to or stored by the client; `hostEnvPresence`
	// (name -> whether this process's env currently has a value) drives the
	// per-row "set on host" / "missing" hint. Seeded from the server-rendered prop,
	// then refreshed from each save response so a newly-added name doesn't read as
	// "missing" until the next full page load.
	// svelte-ignore state_referenced_locally
	let hostEnvVars = $state(hostEnvVarsEnabled);
	let savingHostEnvToggle = $state(false);
	let hostEnvToggleError = $state<string | null>(null);

	const hostEnvVarsToggleOpts = toggleOpts<{ presence: Record<string, boolean> }>({
		set: (v) => (hostEnvVars = v),
		setSaving: (v) => (savingHostEnvToggle = v),
		setError: (v) => (hostEnvToggleError = v),
		onSuccess: (data) => {
			hostEnvPresence = data?.presence ?? {};
		}
	});

	// svelte-ignore state_referenced_locally
	let hostEnvNames = $state([...hostEnvVarNames]);
	// svelte-ignore state_referenced_locally
	let hostEnvPresence = $state({ ...hostEnvVarPresence });
	let newHostEnvName = $state('');
	let savingHostEnvNames = $state(false);
	let hostEnvNamesMsg = $state<string | null>(null);
	let hostEnvNamesError = $state<string | null>(null);

	/**
	 * Add form: submits every existing name (as hidden inputs) plus the free-text
	 * input, all under the repeated `names` field — the last entry is always the
	 * typed value. Validated and normalized (uppercased, deduped) here, in the
	 * submit callback, by mutating `formData` directly before the fetch fires —
	 * mirrors the old client-side pre-check without a second code path.
	 */
	const addHostEnvOpts: MochiEnhanceOptions<{ presence: Record<string, boolean> }, ActionFailure> =
		{
			onPending: (v) => (savingHostEnvNames = v),
			submit: ({ formData, cancel }) => {
				hostEnvNamesError = null;
				hostEnvNamesMsg = null;
				const existing = formData.getAll('names').map(String);
				const typed = existing.pop() ?? '';
				const name = typed.trim().toUpperCase();
				if (!name) {
					cancel();
					return;
				}
				if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
					hostEnvNamesError = `Invalid variable name: ${name}`;
					cancel();
					return;
				}
				newHostEnvName = '';
				if (existing.includes(name)) {
					cancel();
					return;
				}
				const names = [...existing, name];
				formData.delete('names');
				for (const n of names) formData.append('names', n);
				return ({ result }) => {
					if (result.type === 'success') {
						hostEnvNames = names;
						hostEnvPresence = result.data?.presence ?? {};
						hostEnvNamesMsg = 'Saved.';
					} else if (result.type === 'failure') {
						hostEnvNamesError = result.data?.error ?? 'Request failed';
					} else if (result.type === 'error') {
						hostEnvNamesError = 'Network error. Try again.';
					}
				};
			}
		};

	/** Remove form (one per row): submits every name except this one. */
	function removeHostEnvOpts(name: string) {
		return saveOpts<{ presence: Record<string, boolean> }>({
			setSaving: (v) => (savingHostEnvNames = v),
			setError: (v) => (hostEnvNamesError = v),
			setMsg: (v) => (hostEnvNamesMsg = v),
			onSuccess: (data) => {
				hostEnvNames = hostEnvNames.filter((n) => n !== name);
				hostEnvPresence = data?.presence ?? {};
			}
		});
	}

	function toggleSound(on: boolean) {
		sound = on;
		setSoundEnabled(on);
		// A toggle is a user gesture — unlock audio and preview when enabling.
		unlockAudio();
		if (on) playChime('done');
	}

	// Easter egg: the coin in the corner opens a pixel editor for drawing (and
	// contributing) a new avatar sprite.
	let avatarEditorOpen = $state(false);

	function openAvatarEditor() {
		unlockAudio();
		if (sound) playChime('done');
		avatarEditorOpen = true;
	}

	// The server exits ~150ms after the action resolves, so the fetch may complete
	// normally or the connection may drop mid-flight — both mean "shutting down".
	const shutdownOpts: MochiEnhanceOptions<Record<string, never>, ActionFailure> = {
		submit: ({ cancel }) => {
			if (
				!confirm(
					'Delete the database, remove all instances and their containers, and shut down the server? This cannot be undone.'
				)
			) {
				cancel();
				return;
			}
			shuttingDown = true;
		}
	};
</script>

<div class="page">
	<AppBar>
		<span class="title">Settings</span>
	</AppBar>

	<main class="content">
		<section class="card">
			<form
				class="row image-row"
				method="POST"
				action="?/defaultImage"
				bind:this={imageFormEl}
				{@attach enhance(imageOpts)}
			>
				<div class="label">
					<Container size={18} />
					<div class="text">
						<div class="name">
							Default container image
							{#if dockerArch}
								<span class="arch" title="Docker daemon architecture">{dockerArch}</span>
							{/if}
						</div>
						<div class="desc">
							Used only when a project folder ships no devcontainer.json. Takes effect for instances
							created from now on.
						</div>
					</div>
				</div>
				<div class="image-controls">
					<input
						type="text"
						name="image"
						class="image-input"
						bind:value={image}
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
						placeholder="mcr.microsoft.com/devcontainers/base:ubuntu"
					/>
					<Button type="submit" disabled={savingImage}>Save</Button>
					<Button
						type="button"
						icon={RotateCcw}
						disabled={savingImage}
						onclick={resetImage}
						title="Reset to default ({builtinImage})"
						aria-label="Reset to default image"
					/>
				</div>
				<div class="desc tip">
					{#if dockerArch}
						Your Docker daemon runs on <strong>{dockerArch}</strong> — pick an image that publishes
						an <strong>{dockerArch}</strong> manifest, or the pull will fail.
					{:else}
						Pick an image whose manifest covers your Docker daemon's architecture, or the pull will
						fail.
					{/if}
				</div>
				{#if imageError}
					<div class="msg error">{imageError}</div>
				{:else if imageSaved}
					<div class="msg ok">Saved.</div>
				{/if}
			</form>
		</section>

		<section class="card">
			<form
				class="row"
				method="POST"
				action="?/disableBuildCache"
				{@attach enhance(buildCacheToggleOpts)}
			>
				<div class="label">
					<Layers size={18} />
					<div class="text">
						<div class="name">Disable build cache</div>
						<div class="desc">
							Build every new container with <code>--build-no-cache</code>. Applies to first boot
							and rebuilds — slower, but always picks up upstream image/layer changes.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={noCache}
						disabled={savingCache}
						onchange={(e) => {
							noCache = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if cacheError}
				<div class="sub"><div class="msg error">{cacheError}</div></div>
			{/if}

			<form
				class="row divided"
				method="POST"
				action="?/clearBuildCache"
				{@attach enhance(clearCacheOpts)}
			>
				<div class="label">
					<Trash2 size={18} />
					<div class="text">
						<div class="name">Clear build cache</div>
						<div class="desc">
							Purge Docker's BuildKit layer cache now, so the next build runs uncached. Doesn't
							remove pulled images.
						</div>
						{#if clearError}
							<div class="msg error">{clearError}</div>
						{:else if clearMsg}
							<div class="msg ok">{clearMsg}</div>
						{/if}
					</div>
				</div>
				<Button type="submit" icon={Trash2} disabled={clearing}>
					{clearing ? 'Clearing…' : 'Clear cache'}
				</Button>
			</form>

			<form
				class="row divided"
				method="POST"
				action="?/rebuildAllNoCache"
				{@attach enhance(rebuildAllOpts)}
			>
				<div class="label">
					<Hammer size={18} />
					<div class="text">
						<div class="name">Rebuild running containers (no cache)</div>
						<div class="desc">
							Re-run <code>devcontainer up --build-no-cache</code> for every currently-running instance.
							In-container edits are kept; stopped instances are left alone.
						</div>
						{#if rebuildError}
							<div class="msg error">{rebuildError}</div>
						{:else if rebuildMsg}
							<div class="msg ok">{rebuildMsg}</div>
						{/if}
					</div>
				</div>
				<Button type="submit" icon={Hammer} disabled={rebuilding}>
					{rebuilding ? 'Starting…' : 'Rebuild all'}
				</Button>
			</form>
		</section>

		<section class="card" class:disabled-card={customEndpoint}>
			<form
				class="row"
				method="POST"
				action="?/manualTokensToggle"
				{@attach enhance(manualTokensToggleOpts)}
			>
				<div class="label">
					<KeyRound size={18} />
					<div class="text">
						<div class="name">
							Set tokens manually
							{#if customEndpoint}
								<span class="arch" title="Disabled while LiteLLM + Bedrock mode is on"
									>disabled</span
								>
							{/if}
						</div>
						<div class="desc">
							{#if customEndpoint}
								Not available while LiteLLM + Bedrock mode is enabled — Claude credentials are
								provided by the LiteLLM endpoint instead.
							{:else}
								Provide GitHub and Claude Code tokens yourself instead of discovering them from this
								machine. Useful on a headless server or when signed in as a different identity. A
								token set here is injected into every new container and overrides host credential
								discovery.
							{/if}
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={manualTokens}
						disabled={savingManualToggle || customEndpoint}
						onchange={(e) => {
							manualTokens = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if manualToggleError}
				<div class="sub"><div class="msg error">{manualToggleError}</div></div>
			{/if}

			{#if manualTokens && !customEndpoint}
				<form
					class="row divided token-row"
					method="POST"
					action="?/githubToken"
					{@attach enhance(githubTokenOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">GitHub token</div>
							<div class="desc">
								macOS / Linux: run <code>gh auth token</code> to print your GitHub CLI token, or
								create a Personal Access Token at
								<code>github.com/settings/tokens</code> (scopes: <code>repo</code>,
								<code>read:org</code>). Leave blank and Save to clear.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="password"
							name="githubToken"
							class="image-input"
							bind:value={githubToken}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder={ghSaved ? '•••••••• (saved)' : 'ghp_… / gho_…'}
						/>
						<Button type="submit" disabled={savingGithub}>Save</Button>
					</div>
					{#if githubError}
						<div class="msg error">{githubError}</div>
					{:else if githubMsg}
						<div class="msg ok">{githubMsg}</div>
					{/if}
				</form>

				<form
					class="row divided token-row"
					method="POST"
					action="?/claudeToken"
					{@attach enhance(claudeTokenOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Claude Code token</div>
							<div class="desc">
								Paste the OAuth <code>accessToken</code>. macOS:
								<code>security find-generic-password -s "Claude Code-credentials" -w</code> — copy
								the <code>accessToken</code> field. Linux:
								<code>cat ~/.claude/.credentials.json</code> — copy the <code>accessToken</code>.
								Leave blank and Save to clear.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="password"
							name="claudeToken"
							class="image-input"
							bind:value={claudeToken}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder={claudeSaved ? '•••••••• (saved)' : 'sk-ant-oat…'}
						/>
						<Button type="submit" disabled={savingClaude}>Save</Button>
					</div>
					{#if claudeError}
						<div class="msg error">{claudeError}</div>
					{:else if claudeMsg}
						<div class="msg ok">{claudeMsg}</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card" class:disabled-card={manualTokens}>
			<form
				class="row"
				method="POST"
				action="?/customEndpointToggle"
				{@attach enhance(customEndpointToggleOpts)}
			>
				<div class="label">
					<KeyRound size={18} />
					<div class="text">
						<div class="name">
							LiteLLM + Bedrock
							{#if manualTokens}
								<span class="arch" title="Disabled while Set tokens manually is on">disabled</span>
							{/if}
						</div>
						<div class="desc">
							{#if manualTokens}
								Not available while "Set tokens manually" is enabled — these modes are mutually
								incompatible.
							{:else}
								Route <code>claude</code> through a LiteLLM proxy fronting AWS Bedrock instead of Anthropic's
								default API. When enabled, the Bedrock endpoint variables are injected into every new
								container, host OAuth credentials are not used, and "Set tokens manually" is disabled.
							{/if}
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={customEndpoint}
						disabled={savingCustomToggle || manualTokens}
						onchange={(e) => {
							customEndpoint = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if customToggleError}
				<div class="sub"><div class="msg error">{customToggleError}</div></div>
			{/if}

			{#if customEndpoint}
				<form
					class="row divided token-row"
					method="POST"
					action="?/customBaseUrl"
					{@attach enhance(customBaseUrlOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Base URL</div>
							<div class="desc">
								The LiteLLM proxy endpoint, e.g.
								<code>https://litellm.example.com/bedrock</code>. Passed as
								<code>ANTHROPIC_BEDROCK_BASE_URL</code>.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="text"
							name="baseUrl"
							class="image-input"
							bind:value={customBaseUrl}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder="https://litellm.example.com/bedrock"
						/>
						<Button type="submit" disabled={savingCustomBaseUrl}>Save</Button>
					</div>
					{#if customBaseUrlError}
						<div class="msg error">{customBaseUrlError}</div>
					{:else if customBaseUrlMsg}
						<div class="msg ok">{customBaseUrlMsg}</div>
					{/if}
				</form>

				<form
					class="row divided token-row"
					method="POST"
					action="?/customToken"
					{@attach enhance(customTokenOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Auth token</div>
							<div class="desc">
								Your LiteLLM API key. Passed as <code>ANTHROPIC_AUTH_TOKEN</code>. Leave blank and
								Save to clear.
							</div>
						</div>
					</div>
					<div class="image-controls">
						<input
							type="password"
							name="token"
							class="image-input"
							bind:value={customToken}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder={customTokenSaved ? '•••••••• (saved)' : 'sk-…'}
						/>
						<Button type="submit" disabled={savingCustomToken}>Save</Button>
					</div>
					{#if customTokenError}
						<div class="msg error">{customTokenError}</div>
					{:else if customTokenMsg}
						<div class="msg ok">{customTokenMsg}</div>
					{/if}
				</form>

				<form
					class="row divided token-row"
					method="POST"
					action="?/customModels"
					{@attach enhance(customModelsOpts)}
				>
					<div class="label">
						<div class="text">
							<div class="name">Model IDs</div>
							<div class="desc">
								Model aliases to use for each tier. Prefilled with defaults from the reference
								launcher script. Leave a field as-is to keep its current value.
							</div>
						</div>
					</div>
					<div class="model-fields">
						<label class="model-row">
							<span class="model-label">Opus</span>
							<input
								type="text"
								name="opusModel"
								class="image-input"
								bind:value={customOpusModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Sonnet</span>
							<input
								type="text"
								name="sonnetModel"
								class="image-input"
								bind:value={customSonnetModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Haiku</span>
							<input
								type="text"
								name="haikuModel"
								class="image-input"
								bind:value={customHaikuModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Small/fast</span>
							<input
								type="text"
								name="smallFastModel"
								class="image-input"
								bind:value={customSmallFastModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<label class="model-row">
							<span class="model-label">Default</span>
							<input
								type="text"
								name="defaultModel"
								class="image-input"
								bind:value={customDefaultModel}
								spellcheck="false"
								autocapitalize="off"
								autocorrect="off"
								autocomplete="off"
							/>
						</label>
						<div class="model-save-row">
							<Button type="submit" disabled={savingCustomModels}>Save models</Button>
						</div>
					</div>
					{#if customModelsError}
						<div class="msg error">{customModelsError}</div>
					{:else if customModelsMsg}
						<div class="msg ok">{customModelsMsg}</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card">
			<form
				class="row"
				method="POST"
				action="?/hostEnvVarsToggle"
				{@attach enhance(hostEnvVarsToggleOpts)}
			>
				<div class="label">
					<Variable size={18} />
					<div class="text">
						<div class="name">Host environment variables</div>
						<div class="desc">
							Forward selected environment variables from this machine into every new container's
							interactive shells. Values are read from this process's own environment at container
							start and are never shown here or stored — only the variable names are saved.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						name="enabled"
						checked={hostEnvVars}
						disabled={savingHostEnvToggle}
						onchange={(e) => {
							hostEnvVars = e.currentTarget.checked;
							e.currentTarget.form?.requestSubmit();
						}}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</form>
			{#if hostEnvToggleError}
				<div class="sub"><div class="msg error">{hostEnvToggleError}</div></div>
			{/if}

			{#if hostEnvVars}
				<div class="row divided var-row">
					<div class="var-list">
						{#each hostEnvNames as name (name)}
							<form
								class="var-item"
								method="POST"
								action="?/hostEnvVarNames"
								{@attach enhance(removeHostEnvOpts(name))}
							>
								{#each hostEnvNames.filter((n) => n !== name) as other (other)}
									<input type="hidden" name="names" value={other} />
								{/each}
								<span class="var-name">{name}</span>
								<span
									class="var-status"
									class:present={hostEnvPresence[name]}
									title={hostEnvPresence[name]
										? 'Set on this host — will be injected'
										: 'Not set on this host — will be skipped'}
								>
									{hostEnvPresence[name] ? 'set' : 'missing'}
								</span>
								<button
									type="submit"
									class="var-remove"
									disabled={savingHostEnvNames}
									aria-label={`Remove ${name}`}
								>
									<X size={13} />
								</button>
							</form>
						{:else}
							<div class="var-empty">No variables added yet.</div>
						{/each}
					</div>
					<form
						class="var-add"
						method="POST"
						action="?/hostEnvVarNames"
						{@attach enhance(addHostEnvOpts)}
					>
						{#each hostEnvNames as name (name)}
							<input type="hidden" name="names" value={name} />
						{/each}
						<input
							type="text"
							name="names"
							class="image-input"
							bind:value={newHostEnvName}
							spellcheck="false"
							autocapitalize="off"
							autocorrect="off"
							autocomplete="off"
							placeholder="AWS_ACCESS_KEY_ID"
						/>
						<Button type="submit" icon={Plus} disabled={savingHostEnvNames}>Add</Button>
					</form>
					{#if hostEnvNamesError}
						<div class="msg error">{hostEnvNamesError}</div>
					{:else if hostEnvNamesMsg}
						<div class="msg ok">{hostEnvNamesMsg}</div>
					{/if}
				</div>
			{/if}
		</section>

		<section class="card">
			<div class="row">
				<div class="label">
					<SunMoon size={18} />
					<div class="text">
						<div class="name">Theme</div>
						<div class="desc">
							Light, dark, or follow the browser preference automatically (auto).
						</div>
					</div>
				</div>
				<ThemePicker />
			</div>
		</section>

		<section class="card">
			<div class="row">
				<div class="label">
					<Volume2 size={18} />
					<div class="text">
						<div class="name">Attention sound</div>
						<div class="desc">
							Play a chime when an instance finishes a task or needs your input.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						checked={sound}
						onchange={(e) => toggleSound(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
		</section>

		<section class="card danger-card">
			<form class="row" method="POST" action="?/shutdown" {@attach enhance(shutdownOpts)}>
				<div class="label">
					<Power size={18} />
					<div class="text">
						<div class="name">Delete database, containers, and shut down</div>
						<div class="desc">
							Stop and remove every instance and its container, delete all copied workspaces and the
							database, then shut down the server. This cannot be undone.
						</div>
					</div>
				</div>
				{#if shuttingDown}
					<span class="shutting">Server is shutting down — you can close this tab.</span>
				{:else}
					<Button type="submit" variant="danger">Delete &amp; shut down</Button>
				{/if}
			</form>
		</section>

		<CoinButton onclick={openAvatarEditor} />
	</main>

	{#if avatarEditorOpen}
		<AvatarEditor onclose={() => (avatarEditorOpen = false)} />
	{/if}
</div>

<!-- The Settings page renders outside AppShell (which hosts the app-wide
     Toaster), so the avatar editor's copy toast needs its own mount. -->
<Toaster
	toastOptions={{
		style:
			'border:1px solid var(--ink); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--ink); font-family:var(--font-mono); font-size:13px;'
	}}
/>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	.title {
		display: inline-flex;
		align-items: center;
		padding: 0 14px;
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 32px 20px;
	}
	.card {
		width: 100%;
		max-width: 560px;
		background: var(--bg-card);
		border: 1px solid var(--rule);
		height: max-content;
	}
	.danger-card {
		border-color: var(--danger);
	}
	/* Muted appearance for a card whose controls are locked by another setting. */
	.disabled-card {
		opacity: 0.55;
		pointer-events: none;
	}
	/* Keep the action button on one line; in the flex row it would otherwise shrink and wrap. */
	.danger-card :global(.btn) {
		flex: none;
		white-space: nowrap;
	}
	.shutting {
		flex: none;
		max-width: 200px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
		line-height: 1.4;
		text-align: right;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 18px;
	}
	/* Secondary rows stacked inside one card, separated by a hairline rule. */
	.row.divided {
		border-top: 1px solid var(--rule);
		align-items: flex-start;
	}
	.row.divided :global(.btn) {
		flex: none;
		white-space: nowrap;
	}
	/* Inline message tucked under a row (e.g. a toggle's error), matching row padding. */
	.sub {
		padding: 0 18px 14px;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		padding: 1px 4px;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 3px;
	}
	.label {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		color: var(--ink);
		min-width: 0;
	}
	.text {
		min-width: 0;
	}
	.name {
		font-family: var(--font-mono);
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.arch {
		margin-left: 8px;
		padding: 2px 6px;
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		border: 1px solid var(--rule);
		border-radius: 3px;
		vertical-align: middle;
	}
	.tip {
		width: 100%;
		margin-top: 4px;
		padding: 8px 10px;
		color: var(--ink-soft);
		background: color-mix(in srgb, var(--info) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--info) 35%, transparent);
		border-radius: 4px;
	}
	.desc {
		margin-top: 4px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
		line-height: 1.4;
	}
	/* Default-image editor: input + Save, stacked under the label on narrow widths. */
	.image-row {
		flex-wrap: wrap;
	}
	/* Manual-token rows: same input+Save layout, allowed to wrap so the help text and
	   the "Saved." message drop below the field on narrow widths. */
	.token-row {
		flex-wrap: wrap;
	}
	.image-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 220px;
		justify-content: flex-end;
	}
	.image-input {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--rule);
	}
	.image-input:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 1px;
	}
	.image-controls :global(.btn) {
		flex: none;
	}
	.msg {
		width: 100%;
		margin-top: 2px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.4;
	}
	.msg.error {
		color: var(--danger);
	}
	.msg.ok {
		color: var(--ink-soft);
	}
	/* Switch */
	.switch {
		position: relative;
		flex: none;
		cursor: pointer;
	}
	.switch input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.track {
		display: block;
		width: 44px;
		height: 24px;
		border: 1px solid var(--rule);
		background: var(--bg);
		border-radius: 999px;
		transition: background 0.15s ease;
	}
	.thumb {
		display: block;
		width: 18px;
		height: 18px;
		margin: 2px;
		background: var(--ink-faint);
		border-radius: 999px;
		transition:
			transform 0.15s ease,
			background 0.15s ease;
	}
	.switch input:checked + .track {
		background: var(--switch-on-bg);
	}
	.switch input:checked + .track .thumb {
		transform: translateX(20px);
		background: var(--ink);
	}
	.switch input:focus-visible + .track {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	/* Model-ID fields: a stacked list of label + input pairs with a Save button below. */
	.model-fields {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 220px;
	}
	.model-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.model-label {
		flex: none;
		width: 72px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-soft);
		text-align: right;
	}
	.model-row .image-input {
		flex: 1;
	}
	.model-save-row {
		display: flex;
		justify-content: flex-end;
		margin-top: 4px;
	}
	/* Host env var list: a stacked list of name/status/remove rows, plus an add form. */
	.var-row {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
	}
	.var-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.var-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--bg);
		border: 1px solid var(--rule);
	}
	.var-name {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		word-break: break-all;
	}
	.var-status {
		flex: none;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--danger);
	}
	.var-status.present {
		color: var(--ink-soft);
	}
	.var-remove {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		color: var(--ink-soft);
		background: transparent;
		border: 1px solid var(--rule);
		cursor: pointer;
	}
	.var-remove:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
	}
	.var-remove:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.var-empty {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
	}
	.var-add {
		display: flex;
		gap: 8px;
	}
	.var-add :global(.btn) {
		flex: none;
	}
</style>
