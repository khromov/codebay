<script lang="ts">
	import Container from '@lucide/svelte/icons/container';
	import AppBar from './AppBar.svelte';
	import Power from '@lucide/svelte/icons/power';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import Layers from '@lucide/svelte/icons/layers';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Hammer from '@lucide/svelte/icons/hammer';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { soundEnabled, setSoundEnabled } from '../settings.ts';
	import { playChime, unlockAudio } from '../sound.ts';
	import { apiPost } from '../api.ts';
	import Button from './Button.svelte';

	let {
		defaultImage,
		builtinImage,
		disableBuildCache,
		dockerArch,
		manualTokensEnabled,
		githubTokenSet,
		claudeTokenSet
	}: {
		defaultImage: string;
		builtinImage: string;
		disableBuildCache: boolean;
		dockerArch: string | null;
		manualTokensEnabled: boolean;
		githubTokenSet: boolean;
		claudeTokenSet: boolean;
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

	function toggleSound(on: boolean) {
		sound = on;
		setSoundEnabled(on);
		// A toggle is a user gesture — unlock audio and preview when enabling.
		unlockAudio();
		if (on) playChime('done');
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

		<section class="card">
			<div class="row">
				<div class="label">
					<KeyRound size={18} />
					<div class="text">
						<div class="name">Set tokens manually</div>
						<div class="desc">
							Provide GitHub and Claude Code tokens yourself instead of discovering them from this
							machine. Useful on a headless server or when signed in as a different identity. A
							token set here is injected into every new container and overrides host credential
							discovery.
						</div>
					</div>
				</div>
				<label class="switch">
					<input
						type="checkbox"
						checked={manualTokens}
						disabled={savingManualToggle}
						onchange={(e) => toggleManualTokens(e.currentTarget.checked)}
					/>
					<span class="track"><span class="thumb"></span></span>
				</label>
			</div>
			{#if manualToggleError}
				<div class="sub"><div class="msg error">{manualToggleError}</div></div>
			{/if}

			{#if manualTokens}
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
	</main>
</div>

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
</style>
