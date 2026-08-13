<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { onMount } from 'svelte';
	import toast, { Toaster } from 'svelte-french-toast';
	import { TOAST_OPTIONS } from '../toast.ts';
	import { avatars } from '../avatars/index.ts';
	import type { AuthProvider, InstanceHealth, PortForward, Preflight } from '../types.ts';

	let { preflight }: { preflight: Preflight } = $props();
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import Brand from './Brand.svelte';
	import CredMenu from './CredMenu.svelte';
	import SettingsCog from './SettingsCog.svelte';
	import TopBar from './TopBar.svelte';
	import IdeLoader from './IdeLoader.svelte';
	import HealthBox from './HealthBox.svelte';
	import BranchBox from './BranchBox.svelte';
	import PortsBox from './PortsBox.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import InstanceCard from './InstanceCard.svelte';
	import ComponentDemo from './ui-showcase/ComponentDemo.svelte';
	import type { Instance } from '../types.ts';

	// Both the fill and the printed value are read back off the rendered chip, so this
	// list is the only thing to touch when shell.html gains a token — and the labels
	// can't drift from the theme the way a hardcoded hex did.
	const palette: { group: string; tokens: string[] }[] = [
		{ group: 'Surfaces', tokens: ['--bg', '--bg-card', '--screen-bg', '--screen-ink'] },
		{ group: 'Ink / text', tokens: ['--ink', '--ink-soft', '--ink-faint', '--led-gray'] },
		{ group: 'Structure', tokens: ['--edge', '--shadow', '--rule', '--rule-soft', '--grid-line'] },
		{ group: 'Inverted fill', tokens: ['--fill', '--fill-ink'] },
		{
			group: 'Semantic',
			tokens: [
				'--warn-bg',
				'--warn-line',
				'--warn-ink',
				'--ok-bg',
				'--ok-line',
				'--ok-ink',
				'--danger',
				'--danger-soft',
				'--info'
			]
		},
		{ group: 'Attention', tokens: ['--attn-done', '--attn-waiting', '--switch-on-bg'] }
	];

	const chips: Record<string, HTMLElement> = {};
	let hexes = $state<Record<string, string>>({});

	/** `rgb(r g b / a)` or `rgba(r, g, b, a)` -> `#rrggbb`, with any alpha spelled out. */
	function toHex(value: string): string {
		const parts = value.match(/[\d.]+/g);
		if (!parts || parts.length < 3) return value;
		const hex = parts
			.slice(0, 3)
			.map((n) => Math.round(Number(n)).toString(16).padStart(2, '0'))
			.join('');
		const alpha = parts.length > 3 ? Number(parts[3]) : 1;
		return alpha < 1 ? `#${hex} ${Math.round(alpha * 100)}%` : `#${hex}`;
	}

	function readHexes() {
		hexes = Object.fromEntries(
			Object.entries(chips).map(([token, node]) => [
				token,
				toHex(getComputedStyle(node).backgroundColor)
			])
		);
	}

	onMount(() => {
		readHexes();
		// An explicit pick mutates data-theme; "auto" only moves when the OS does.
		const obs = new MutationObserver(readHexes);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		const scheme = window.matchMedia('(prefers-color-scheme: dark)');
		scheme.addEventListener('change', readHexes);
		return () => {
			obs.disconnect();
			scheme.removeEventListener('change', readHexes);
		};
	});

	let avatarScale = $state(8);
	let avatarName = $state('demo-instance');
	// '' renders an empty panel; otherwise the value is an avatar name from the catalog.
	let avatarArtName = $state(avatars[0]!.name);
	const avatarArt = $derived(avatars.find((a) => a.name === avatarArtName));

	let btnVariant = $state<'default' | 'primary' | 'danger'>('primary');
	let btnSize = $state<'sm' | 'md' | 'lg'>('md');
	let btnDisabled = $state(false);
	let btnIcon = $state(true);
	let btnLabel = $state('New Instance');

	let loaderSpeed = $state(1);
	// The stalled state normally needs a 10s wait on a wedged health probe to appear;
	// `stalledAfterMs: 0` renders it straight away so it's inspectable here.
	let loaderStalled = $state(false);

	// Seed from the server's real preflight so the menu mirrors `/`; the presets
	// and checkboxes below then let you exercise the other aggregate states.
	// svelte-ignore state_referenced_locally
	let providers = $state<AuthProvider[]>($state.snapshot(preflight.auth));
	function presetCred(state: 'ok' | 'warn' | 'error') {
		providers.forEach((p, i) => {
			// warn = mixed: first provider on, the rest off.
			p.available = state === 'ok' || (state === 'warn' && i === 0);
		});
	}

	let healthLoading = $state(false);
	let healthChecks = $state({
		containerRunning: true,
		codeServerAccessible: true,
		claudeCode: true,
		github: false,
		attentionHooks: true
	});
	// Stamp a fetch time so the "updated Ns ago" readout ticks; "refresh" resets it.
	let healthFetchedAt = $state(Date.now());
	const demoHealth = $derived<InstanceHealth | null>(
		healthLoading
			? null
			: {
					containerRunning: healthChecks.containerRunning,
					codeServerAccessible: healthChecks.codeServerAccessible,
					injections: [
						{ id: 'claude-code-credentials', label: 'Claude Code', ok: healthChecks.claudeCode },
						{ id: 'github-credentials', label: 'GitHub CLI', ok: healthChecks.github },
						{ id: 'attention-hooks', label: 'Claude hooks', ok: healthChecks.attentionHooks }
					],
					openPorts: [],
					checkedAt: healthFetchedAt
				}
	);

	// `openCount` of the `portCount` ports render as published (filled dot); the rest
	// show hollow. Count 0 exercises the empty state (renders nothing).
	let portCount = $state(3);
	let openCount = $state(2);
	const demoPorts = $derived<PortForward[]>(
		Array.from({ length: portCount }, (_, i) => ({
			container_port: 3000 + i,
			host_port: 8001 + i,
			open: i < openCount
		}))
	);

	let branchName = $state('main');

	// The dashboard's headline surface — it composes Avatar, StatusBadge, PortsBox,
	// BranchBox and Button, so it's the one place their interplay is reviewable.
	let cardStatus = $state<Instance['status']>('running');
	let cardAttention = $state<Instance['attention']>('waiting');
	let cardPending = $state<'' | 'start' | 'stop' | 'delete' | 'rebuild'>('');
	let cardMode = $state<Instance['mode']>('ide');
	let cardBranch = $state(true);
	let cardEditing = $state(false);
	let cardEditingName = $state('demo-instance');
	const cardActions = ['', 'start', 'stop', 'delete', 'rebuild'] as const;
	const demoInstance = $derived<Instance>({
		id: 'demo',
		name: 'demo-instance',
		source_path: '/home/you/code/demo-instance',
		workspace_path: '/home/you/.codebay/instances/demo',
		host_port: 8001,
		container_id: 'abc123',
		remote_workspace_folder: '/workspaces/demo-instance',
		status: cardStatus,
		error: cardStatus === 'error' ? 'devcontainer up failed: exit code 1' : null,
		created_at: 0,
		image_source: 'local',
		avatar: avatars[0]!.name,
		mode: cardMode,
		terminal_split: 0,
		git_branch: cardBranch ? branchName : null,
		attention: cardAttention,
		forwarded_ports: demoPorts
	});

	const statuses: Instance['status'][] = ['creating', 'running', 'stopped', 'error'];
	let badgeStatus = $state<Instance['status']>('error');
</script>

<Toaster toastOptions={TOAST_OPTIONS} />

<TopBar
	auth={providers}
	canDelete={true}
	ready={true}
	creating={false}
	onNew={(mode) => toast(`New ${mode ?? 'default'} instance (demo)`)}
	onDeleteAll={() => toast('Delete all (demo)')}
/>

<main class="showcase">
	<header>
		<h1>UI</h1>
		<p>Component showcase · dev preview · tweak each component’s props below</p>
		<a class="gallery-link" href="/avatars">→ Avatar sprite gallery</a>
	</header>

	<div class="grid">
		<details class="palette-card panel" open>
			<summary>
				<span class="palette-title">Color palette</span>
				<span class="palette-hint">Design tokens — tap to expand</span>
			</summary>
			<div class="palette">
				{#each palette as { group, tokens } (group)}
					<div class="swatch-group">
						<h3>{group}</h3>
						<div class="swatches">
							{#each tokens as token (token)}
								<figure class="swatch">
									<div
										class="chip"
										bind:this={chips[token]}
										style="background: var({token});"
									></div>
									<figcaption>
										<code>{token}</code>
										<span>{hexes[token] ?? '…'}</span>
									</figcaption>
								</figure>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</details>

		<ComponentDemo title="InstanceCard">
			<!-- The card renders an <li>, and .card-grid mirrors the dashboard's own
			     column so its width and hover lift match what ships. -->
			<ul class="card-grid">
				<InstanceCard
					instance={demoInstance}
					editing={cardEditing}
					bind:editingName={cardEditingName}
					pending={cardPending || null}
					onact={(a) => toast(`${a} (demo)`)}
					onstartrename={() => (cardEditing = true)}
					oncommitrename={() => (cardEditing = false)}
					oncancelrename={() => (cardEditing = false)}
				/>
			</ul>
			{#snippet controls()}
				<label>
					<span>status</span>
					<select bind:value={cardStatus}>
						{#each statuses as s (s)}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>attention</span>
					<select bind:value={cardAttention}>
						<option value={null}>none</option>
						<option value="done">done</option>
						<option value="waiting">waiting</option>
					</select>
				</label>
				<label>
					<span>pending (busy overlay)</span>
					<select bind:value={cardPending}>
						{#each cardActions as a (a)}
							<option value={a}>{a || 'none'}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>mode</span>
					<select bind:value={cardMode}>
						<option value="ide">ide</option>
						<option value="terminal">terminal</option>
					</select>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={cardBranch} />
					<span>git branch</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={cardEditing} />
					<span>renaming</span>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="Avatar">
			<Avatar name={avatarName} scale={avatarScale} art={avatarArt} />
			{#snippet controls()}
				<label>
					<span>scale ({avatarScale})</span>
					<input type="range" min="1" max="12" bind:value={avatarScale} />
				</label>
				<label>
					<span>name</span>
					<input type="text" bind:value={avatarName} />
				</label>
				<label>
					<span>art</span>
					<select bind:value={avatarArtName}>
						<option value="">(none)</option>
						{#each avatars as art (art.name)}
							<option value={art.name}>{art.name}</option>
						{/each}
					</select>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="Button">
			<Button
				variant={btnVariant}
				size={btnSize}
				disabled={btnDisabled}
				icon={btnIcon ? Plus : undefined}
			>
				{btnLabel}
			</Button>
			{#snippet controls()}
				<label>
					<span>variant</span>
					<select bind:value={btnVariant}>
						<option value="default">default</option>
						<option value="primary">primary</option>
						<option value="danger">danger</option>
					</select>
				</label>
				<label>
					<span>size</span>
					<select bind:value={btnSize}>
						<option value="sm">sm</option>
						<option value="md">md</option>
						<option value="lg">lg</option>
					</select>
				</label>
				<label>
					<span>label</span>
					<input type="text" bind:value={btnLabel} />
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={btnIcon} />
					<span>icon (Plus)</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={btnDisabled} />
					<span>disabled</span>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="CredMenu">
			<CredMenu auth={providers} />
			{#snippet controls()}
				<div class="presets">
					<button type="button" onclick={() => presetCred('ok')}>ok</button>
					<button type="button" onclick={() => presetCred('warn')}>warn</button>
					<button type="button" onclick={() => presetCred('error')}>error</button>
				</div>
				{#each providers as provider (provider.id)}
					<label class="inline">
						<input type="checkbox" bind:checked={provider.available} />
						<span>{provider.label} available</span>
					</label>
				{/each}
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="IdeLoader">
			<div class="loader-stage">
				{#key loaderStalled}
					<IdeLoader
						speed={loaderSpeed}
						stalledAfterMs={loaderStalled ? 0 : undefined}
						onoverride={loaderStalled ? () => {} : undefined}
					/>
				{/key}
			</div>
			{#snippet controls()}
				<label>
					<span>speed ({loaderSpeed.toFixed(2)}×)</span>
					<input type="range" min="0.25" max="3" step="0.25" bind:value={loaderSpeed} />
				</label>
				<label>
					<input type="checkbox" bind:checked={loaderStalled} />
					<span>stalled (probe never answered)</span>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="HealthBox">
			<HealthBox
				health={demoHealth}
				lastFetchedAt={healthLoading ? null : healthFetchedAt}
				injectionChecks={3}
			/>
			{#snippet controls()}
				<div class="presets">
					<button type="button" onclick={() => (healthFetchedAt = Date.now())}>refresh now</button>
				</div>
				<label class="inline">
					<input type="checkbox" bind:checked={healthLoading} />
					<span>loading (skeleton)</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={healthChecks.containerRunning} />
					<span>container running</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={healthChecks.codeServerAccessible} />
					<span>code-server reachable</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={healthChecks.claudeCode} />
					<span>Claude Code present</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={healthChecks.github} />
					<span>GitHub CLI present</span>
				</label>
				<label class="inline">
					<input type="checkbox" bind:checked={healthChecks.attentionHooks} />
					<span>attention hooks present</span>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="PortsBox">
			<PortsBox ports={demoPorts} />
			{#snippet controls()}
				<label>
					<span>ports ({portCount})</span>
					<input type="range" min="0" max="6" bind:value={portCount} />
				</label>
				<label>
					<span>open ({openCount})</span>
					<input type="range" min="0" max={portCount} bind:value={openCount} />
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="BranchBox">
			<BranchBox branch={branchName} />
			{#snippet controls()}
				<label>
					<span>branch</span>
					<input type="text" bind:value={branchName} />
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="StatusBadge" note="All four states, plus one picked below.">
			<div class="badge-row">
				{#each statuses as s (s)}
					<StatusBadge status={s} />
				{/each}
			</div>
			<div class="badge-row">
				<StatusBadge status={badgeStatus} />
			</div>
			{#snippet controls()}
				<label>
					<span>status</span>
					<select bind:value={badgeStatus}>
						{#each statuses as s (s)}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="Brand" note="No props — static branding.">
			<Brand />
		</ComponentDemo>

		<ComponentDemo title="SettingsCog" note="No props — links to /settings.">
			<SettingsCog />
		</ComponentDemo>
	</div>
</main>

<style>
	.showcase {
		min-height: 100vh;
		max-width: 740px;
		margin: 0 auto;
		padding: 32px;
		color: var(--ink);
	}
	header {
		margin-bottom: 28px;
	}
	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 24px;
		letter-spacing: 0.04em;
	}
	header p {
		margin: 4px 0 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
	}
	.gallery-link {
		display: inline-block;
		margin-top: 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		text-decoration: none;
		border-bottom: 1px solid var(--ink);
	}
	.gallery-link:hover {
		background: var(--fill);
		color: var(--fill-ink);
	}
	.grid {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	/* `.fields` lives in the child ComponentDemo, hence the global selector. */
	.showcase :global(.fields label) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-soft);
	}
	.showcase :global(.fields label.inline) {
		flex-direction: row;
		align-items: center;
		gap: 7px;
	}
	.showcase :global(.fields input[type='text']),
	.showcase :global(.fields select) {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--ink);
		padding: 5px 7px;
	}
	.showcase :global(.fields input[type='range']),
	.showcase :global(.fields input[type='checkbox']) {
		accent-color: var(--ink);
	}
	/* IdeLoader is an inset:0 overlay, so give it a sized, positioned stage. */
	.loader-stage {
		position: relative;
		width: 100%;
		height: 180px;
		border: 1px solid var(--rule-soft);
		overflow: hidden;
	}
	/* Matches the dashboard grid's column so the card previews at its real width. */
	.card-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		width: min(360px, 100%);
	}
	.badge-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.presets {
		display: flex;
		gap: 6px;
	}
	.presets button {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink);
		background: var(--bg-card);
		border: 1px solid var(--edge);
		padding: 5px 0;
		cursor: pointer;
	}
	.presets button:hover {
		background: var(--fill);
		border-color: var(--fill);
		color: var(--fill-ink);
	}

	.palette-card {
		background: var(--bg-card);
	}
	.palette-card > summary {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		cursor: pointer;
		user-select: none;
		list-style: none;
	}
	.palette-card > summary::-webkit-details-marker {
		display: none;
	}
	.palette-card[open] > summary {
		border-bottom: 1px solid var(--rule-soft);
	}
	.palette-title {
		font-family: var(--font-display);
		font-size: 16px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.palette-hint {
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
	}
	.palette-card[open] .palette-hint {
		visibility: hidden;
	}
	.palette {
		display: flex;
		flex-direction: column;
		gap: 18px;
		width: 100%;
		padding: 18px 14px;
	}
	.swatch-group h3 {
		margin: 0 0 8px;
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 10px;
	}
	.swatch {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.swatch .chip {
		height: 44px;
		border: 1px solid var(--rule-soft);
	}
	.swatch figcaption {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.35;
	}
	.swatch figcaption code {
		color: var(--ink);
	}
	.swatch figcaption span {
		color: var(--ink-faint);
		text-transform: uppercase;
	}
</style>
