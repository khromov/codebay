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
	import { soundEnabled, setSoundEnabled } from '../settings.ts';
	import { playChime, unlockAudio } from '../sound.ts';
	import { apiPost } from '../api.ts';
	import Button from './Button.svelte';
	import CoinButton from './CoinButton.svelte';
	import AvatarEditor from './AvatarEditor.svelte';

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

	// svelte-ignore state_referenced_locally
	let image = $state(defaultImage);
	let savingImage = $state(false);
	let imageError = $state<string | null>(null);
	let imageSaved = $state(false);

	async function persistImage(value: string) {
		if (!value) {
			imageError = 'Enter an image reference';
			return;
		}
		imageError = null;
		imageSaved = false;
		savingImage = true;
		try {
			await apiPost('/api/settings/default-image', { image: value });
			image = value;
			imageSaved = true;
		} catch (err) {
			imageError = (err as Error).message;
		} finally {
			savingImage = false;
		}
	}

	function saveImage(e: Event) {
		e.preventDefault();
		void persistImage(image.trim());
	}

	// Restore the built-in default image and persist it.
	function resetImage() {
		image = builtinImage;
		void persistImage(builtinImage);
	}

	// Build cache — the DB-backed "disable cache" flag is the source of truth (unlike
	// the localStorage sound toggle), so initialize from the prop and persist on change.
	// svelte-ignore state_referenced_locally
	let noCache = $state(disableBuildCache);
	let savingCache = $state(false);
	let cacheError = $state<string | null>(null);

	let clearing = $state(false);
	let clearMsg = $state<string | null>(null);
	let clearError = $state<string | null>(null);

	let rebuilding = $state(false);
	let rebuildMsg = $state<string | null>(null);
	let rebuildError = $state<string | null>(null);

	function formatBytes(n: number): string {
		if (n <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
		return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	async function toggleBuildCache(on: boolean) {
		noCache = on;
		cacheError = null;
		savingCache = true;
		try {
			await apiPost('/api/settings/disable-build-cache', { enabled: on });
		} catch (err) {
			noCache = !on; // revert the optimistic flip on failure
			cacheError = (err as Error).message;
		} finally {
			savingCache = false;
		}
	}

	async function clearBuildCache() {
		clearError = null;
		clearMsg = null;
		clearing = true;
		try {
			const res = (await apiPost('/api/settings/clear-build-cache')) as { spaceReclaimed?: number };
			clearMsg = `Cleared — freed ${formatBytes(res?.spaceReclaimed ?? 0)}.`;
		} catch (err) {
			clearError = (err as Error).message;
		} finally {
			clearing = false;
		}
	}

	async function rebuildAllNoCache() {
		if (
			!confirm(
				'Rebuild every running container from scratch (no build cache)? Each will restart and may take a while.'
			)
		)
			return;
		rebuildError = null;
		rebuildMsg = null;
		rebuilding = true;
		try {
			const res = (await apiPost('/api/instances/rebuild-all-no-cache')) as { count?: number };
			const n = res?.count ?? 0;
			rebuildMsg = n === 0 ? 'No running containers to rebuild.' : `Rebuilding ${n} container(s)…`;
		} catch (err) {
			rebuildError = (err as Error).message;
		} finally {
			rebuilding = false;
		}
	}

	// Manual credential tokens. The DB is the source of truth; initialize the toggle
	// from the prop. Token values are never sent to the client — we only know whether
	// each is already set (to show a "saved" placeholder) and never render the secret.
	// svelte-ignore state_referenced_locally
	let manualTokens = $state(manualTokensEnabled);
	let savingManualToggle = $state(false);
	let manualToggleError = $state<string | null>(null);

	// svelte-ignore state_referenced_locally
	let ghSaved = $state(githubTokenSet);
	let githubToken = $state('');
	let savingGithub = $state(false);
	let githubMsg = $state<string | null>(null);
	let githubError = $state<string | null>(null);

	// svelte-ignore state_referenced_locally
	let claudeSaved = $state(claudeTokenSet);
	let claudeToken = $state('');
	let savingClaude = $state(false);
	let claudeMsg = $state<string | null>(null);
	let claudeError = $state<string | null>(null);

	async function toggleManualTokens(on: boolean) {
		manualTokens = on;
		manualToggleError = null;
		savingManualToggle = true;
		try {
			await apiPost('/api/settings/manual-tokens', { enabled: on });
		} catch (err) {
			manualTokens = !on; // revert the optimistic flip on failure
			manualToggleError = (err as Error).message;
		} finally {
			savingManualToggle = false;
		}
	}

	async function saveGithubToken(e: Event) {
		e.preventDefault();
		githubError = null;
		githubMsg = null;
		savingGithub = true;
		try {
			await apiPost('/api/settings/manual-tokens', { githubToken: githubToken.trim() });
			ghSaved = githubToken.trim().length > 0;
			githubToken = '';
			githubMsg = ghSaved ? 'Saved.' : 'Cleared.';
		} catch (err) {
			githubError = (err as Error).message;
		} finally {
			savingGithub = false;
		}
	}

	async function saveClaudeToken(e: Event) {
		e.preventDefault();
		claudeError = null;
		claudeMsg = null;
		savingClaude = true;
		try {
			await apiPost('/api/settings/manual-tokens', { claudeToken: claudeToken.trim() });
			claudeSaved = claudeToken.trim().length > 0;
			claudeToken = '';
			claudeMsg = claudeSaved ? 'Saved.' : 'Cleared.';
		} catch (err) {
			claudeError = (err as Error).message;
		} finally {
			savingClaude = false;
		}
	}

	// Custom endpoint (LiteLLM / Bedrock). Like manual tokens: the toggle persists
	// to the DB; each field saves individually via a partial POST. The token value
	// is never returned to the client — we only know whether it was set.
	// svelte-ignore state_referenced_locally
	let customEndpoint = $state(customEndpointEnabled);
	let savingCustomToggle = $state(false);
	let customToggleError = $state<string | null>(null);

	// svelte-ignore state_referenced_locally
	let customBaseUrl = $state(customEndpointBaseUrl);
	let savingCustomBaseUrl = $state(false);
	let customBaseUrlMsg = $state<string | null>(null);
	let customBaseUrlError = $state<string | null>(null);

	let customToken = $state('');
	// svelte-ignore state_referenced_locally
	let customTokenSaved = $state(customEndpointTokenSet);
	let savingCustomToken = $state(false);
	let customTokenMsg = $state<string | null>(null);
	let customTokenError = $state<string | null>(null);

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

	async function toggleCustomEndpoint(on: boolean) {
		customEndpoint = on;
		customToggleError = null;
		savingCustomToggle = true;
		try {
			await apiPost('/api/settings/custom-endpoint', { enabled: on });
		} catch (err) {
			customEndpoint = !on; // revert the optimistic flip on failure
			customToggleError = (err as Error).message;
		} finally {
			savingCustomToggle = false;
		}
	}

	async function saveCustomBaseUrl(e: Event) {
		e.preventDefault();
		customBaseUrlError = null;
		customBaseUrlMsg = null;
		savingCustomBaseUrl = true;
		try {
			await apiPost('/api/settings/custom-endpoint', { baseUrl: customBaseUrl.trim() });
			customBaseUrlMsg = customBaseUrl.trim() ? 'Saved.' : 'Cleared.';
		} catch (err) {
			customBaseUrlError = (err as Error).message;
		} finally {
			savingCustomBaseUrl = false;
		}
	}

	async function saveCustomToken(e: Event) {
		e.preventDefault();
		customTokenError = null;
		customTokenMsg = null;
		savingCustomToken = true;
		try {
			await apiPost('/api/settings/custom-endpoint', { token: customToken.trim() });
			customTokenSaved = customToken.trim().length > 0;
			customToken = '';
			customTokenMsg = customTokenSaved ? 'Saved.' : 'Cleared.';
		} catch (err) {
			customTokenError = (err as Error).message;
		} finally {
			savingCustomToken = false;
		}
	}

	async function saveCustomModels(e: Event) {
		e.preventDefault();
		customModelsError = null;
		customModelsMsg = null;
		savingCustomModels = true;
		try {
			await apiPost('/api/settings/custom-endpoint', {
				opusModel: customOpusModel.trim(),
				sonnetModel: customSonnetModel.trim(),
				haikuModel: customHaikuModel.trim(),
				smallFastModel: customSmallFastModel.trim(),
				defaultModel: customDefaultModel.trim()
			});
			customModelsMsg = 'Saved.';
		} catch (err) {
			customModelsError = (err as Error).message;
		} finally {
			savingCustomModels = false;
		}
	}

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

	// svelte-ignore state_referenced_locally
	let hostEnvNames = $state([...hostEnvVarNames]);
	// svelte-ignore state_referenced_locally
	let hostEnvPresence = $state({ ...hostEnvVarPresence });
	let newHostEnvName = $state('');
	let savingHostEnvNames = $state(false);
	let hostEnvNamesMsg = $state<string | null>(null);
	let hostEnvNamesError = $state<string | null>(null);

	async function toggleHostEnvVars(on: boolean) {
		hostEnvVars = on;
		hostEnvToggleError = null;
		savingHostEnvToggle = true;
		try {
			await apiPost('/api/settings/host-env-vars', { enabled: on });
		} catch (err) {
			hostEnvVars = !on; // revert the optimistic flip on failure
			hostEnvToggleError = (err as Error).message;
		} finally {
			savingHostEnvToggle = false;
		}
	}

	async function saveHostEnvNames(names: string[]) {
		hostEnvNamesError = null;
		hostEnvNamesMsg = null;
		savingHostEnvNames = true;
		try {
			const res = (await apiPost('/api/settings/host-env-vars', { names })) as {
				presence?: Record<string, boolean>;
			};
			hostEnvNames = names;
			hostEnvPresence = res?.presence ?? {};
			hostEnvNamesMsg = 'Saved.';
		} catch (err) {
			hostEnvNamesError = (err as Error).message;
		} finally {
			savingHostEnvNames = false;
		}
	}

	function addHostEnvName(e: Event) {
		e.preventDefault();
		const name = newHostEnvName.trim().toUpperCase();
		if (!name) return;
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			hostEnvNamesError = `Invalid variable name: ${name}`;
			return;
		}
		if (hostEnvNames.includes(name)) {
			newHostEnvName = '';
			return;
		}
		newHostEnvName = '';
		void saveHostEnvNames([...hostEnvNames, name]);
	}

	function removeHostEnvName(name: string) {
		void saveHostEnvNames(hostEnvNames.filter((n) => n !== name));
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

	async function deleteAndShutdown() {
		if (
			!confirm(
				'Delete the database, remove all instances and their containers, and shut down the server? This cannot be undone.'
			)
		)
			return;
		shuttingDown = true;
		try {
			await apiPost('/api/shutdown');
		} catch {
			// The server exits mid-response, so a network error here is expected.
		}
	}
</script>

<div class="page">
	<AppBar>
		<span class="title">Settings</span>
	</AppBar>

	<main class="content">
		<section class="card">
			<form class="row image-row" onsubmit={saveImage}>
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
			<div class="row">
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
						checked={noCache}
						disabled={savingCache}
						onchange={(e) => toggleBuildCache(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
			{#if cacheError}
				<div class="sub"><div class="msg error">{cacheError}</div></div>
			{/if}

			<div class="row divided">
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
				<Button icon={Trash2} disabled={clearing} onclick={clearBuildCache}>
					{clearing ? 'Clearing…' : 'Clear cache'}
				</Button>
			</div>

			<div class="row divided">
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
				<Button icon={Hammer} disabled={rebuilding} onclick={rebuildAllNoCache}>
					{rebuilding ? 'Starting…' : 'Rebuild all'}
				</Button>
			</div>
		</section>

		<section class="card" class:disabled-card={customEndpoint}>
			<div class="row">
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
						checked={manualTokens}
						disabled={savingManualToggle || customEndpoint}
						onchange={(e) => toggleManualTokens(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
			{#if manualToggleError}
				<div class="sub"><div class="msg error">{manualToggleError}</div></div>
			{/if}

			{#if manualTokens && !customEndpoint}
				<form class="row divided token-row" onsubmit={saveGithubToken}>
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

				<form class="row divided token-row" onsubmit={saveClaudeToken}>
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
			<div class="row">
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
						checked={customEndpoint}
						disabled={savingCustomToggle || manualTokens}
						onchange={(e) => toggleCustomEndpoint(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
			{#if customToggleError}
				<div class="sub"><div class="msg error">{customToggleError}</div></div>
			{/if}

			{#if customEndpoint}
				<form class="row divided token-row" onsubmit={saveCustomBaseUrl}>
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

				<form class="row divided token-row" onsubmit={saveCustomToken}>
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

				<form class="row divided token-row" onsubmit={saveCustomModels}>
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
			<div class="row">
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
						checked={hostEnvVars}
						disabled={savingHostEnvToggle}
						onchange={(e) => toggleHostEnvVars(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
			{#if hostEnvToggleError}
				<div class="sub"><div class="msg error">{hostEnvToggleError}</div></div>
			{/if}

			{#if hostEnvVars}
				<div class="row divided var-row">
					<div class="var-list">
						{#each hostEnvNames as name (name)}
							<div class="var-item">
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
									type="button"
									class="var-remove"
									disabled={savingHostEnvNames}
									onclick={() => removeHostEnvName(name)}
									aria-label={`Remove ${name}`}
								>
									<X size={13} />
								</button>
							</div>
						{:else}
							<div class="var-empty">No variables added yet.</div>
						{/each}
					</div>
					<form class="var-add" onsubmit={addHostEnvName}>
						<input
							type="text"
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
			<div class="row">
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
					<Button variant="danger" onclick={deleteAndShutdown}>Delete &amp; shut down</Button>
				{/if}
			</div>
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
