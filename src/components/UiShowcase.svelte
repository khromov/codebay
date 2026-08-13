<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import toast from 'svelte-french-toast';
	import AppToaster from './AppToaster.svelte';
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
	import ComponentDemo from './ui-showcase/ComponentDemo.svelte';
	import ThemePicker from './ThemePicker.svelte';
	import Skeleton from './Skeleton.svelte';
	import InstanceCard from './InstanceCard.svelte';
	import IdeBar from './IdeBar.svelte';
	import FolderBrowser from './FolderBrowser.svelte';
	import type { Instance } from '../types.ts';

	const palette: { group: string; tokens: string[] }[] = [
		{ group: 'Surfaces', tokens: ['--bg', '--bg-card', '--slab', '--slab-ink'] },
		{ group: 'Ink / text', tokens: ['--ink', '--ink-soft', '--ink-faint', '--led-gray'] },
		{
			group: 'Structure',
			tokens: [
				'--edge',
				'--shadow',
				'--rule',
				'--rule-soft',
				'--scrim',
				'--grid-line',
				'--bloom',
				'--skel-sheen'
			]
		},
		{
			group: 'Semantic',
			tokens: [
				'--warn-bg',
				'--warn-line',
				'--warn-ink',
				'--warn-chip',
				'--ok-bg',
				'--ok-line',
				'--ok-ink',
				'--danger',
				'--danger-soft',
				'--info'
			]
		},
		{ group: 'Attention', tokens: ['--attn-done', '--attn-waiting', '--switch-on-bg'] },
		{
			group: 'Console',
			tokens: ['--screen-bg', '--screen-ink', '--screen-line', '--screen-glow']
		}
	];

	// getPropertyValue hands back the literal `light-dark(a, b)` text, so the only way to
	// read what a token actually resolves to is to let an element compute it.
	let probe = $state<HTMLDivElement | null>(null);
	let resolved = $state<Record<string, string>>({});

	function toHex(rgb: string): string {
		const n = rgb.match(/[\d.]+/g)?.map(Number);
		if (!n || n.length < 3) return rgb;
		if (n.length > 3 && n[3] === 0) return 'transparent';
		const hex = n
			.slice(0, 3)
			.map((c) => Math.round(c).toString(16).padStart(2, '0'))
			.join('');
		return n.length > 3 && n[3]! < 1 ? `#${hex} ${Math.round(n[3]! * 100)}%` : `#${hex}`;
	}

	function readPalette() {
		if (!probe) return;
		const next: Record<string, string> = {};
		for (const { tokens } of palette) {
			for (const token of tokens) {
				probe.style.color = `var(${token})`;
				next[token] = toHex(getComputedStyle(probe).color);
			}
		}
		probe.style.color = '';
		resolved = next;
	}

	$effect(() => {
		readPalette();
		// Explicit switches stamp data-theme; auto mode changes only show up via the media query.
		const observer = new MutationObserver(readPalette);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', readPalette);
		return () => {
			observer.disconnect();
			media.removeEventListener('change', readPalette);
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

	const statuses: Instance['status'][] = ['creating', 'running', 'stopped', 'error'];
	let badgeStatus = $state<Instance['status']>('error');

	// Fabricated rows: without a Docker daemon there is no real instance to render, and
	// the card, the tab strip and the folder picker are unreachable from the dashboard.
	function demoInstance(over: Partial<Instance> = {}): Instance {
		return {
			id: 'demo-1',
			name: 'demo-instance',
			source_path: '/home/you/projects/demo',
			workspace_path: '/data/instances/demo-1',
			host_port: 8001,
			container_id: 'c0ffee123456',
			remote_workspace_folder: '/workspaces/demo',
			status: 'running',
			error: null,
			created_at: 0,
			image_source: 'local',
			avatar: avatars[0]!.name,
			mode: 'ide',
			terminal_split: 0,
			git_branch: 'main',
			attention: null,
			forwarded_ports: [{ container_port: 3000, host_port: 8001, open: true }],
			...over
		};
	}

	let cardStatus = $state<Instance['status']>('running');
	let cardAttention = $state<'done' | 'waiting' | null>(null);
	let cardPending = $state(false);
	let cardEditing = $state(false);
	let cardEditingName = $state('demo-instance');
	const demoCard = $derived(
		demoInstance({
			status: cardStatus,
			attention: cardAttention,
			error: cardStatus === 'error' ? 'devcontainer up failed: exit 1' : null
		})
	);

	let ideActive = $state('demo-1');
	let ideEditingName = $state('');
	let ideAttention = $state<Record<string, 'done' | 'waiting' | null>>({
		'demo-1': null,
		'demo-2': 'waiting'
	});
	const demoTabs = [
		demoInstance(),
		demoInstance({ id: 'demo-2', name: 'api-service', avatar: avatars[1]!.name, mode: 'terminal' })
	];

	let pickerOpen = $state(false);
	let skelVariant = $state<'text' | 'pill' | 'wide'>('text');
</script>

<AppToaster />

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
				<div bind:this={probe} class="probe" aria-hidden="true"></div>
				{#each palette as { group, tokens } (group)}
					<div class="swatch-group">
						<h3>{group}</h3>
						<div class="swatches">
							{#each tokens as token (token)}
								<figure class="swatch">
									<div class="chip bordered" style="background: var({token});"></div>
									<figcaption>
										<code>{token}</code>
										<span>{resolved[token] ?? '…'}</span>
									</figcaption>
								</figure>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</details>

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

		<ComponentDemo title="ThemePicker" note="Switches the whole page — the palette above follows.">
			<ThemePicker />
		</ComponentDemo>

		<ComponentDemo title="Skeleton" note="The sweep must read as a highlight in both themes.">
			<div class="skel-stack">
				<Skeleton variant={skelVariant} />
				<Skeleton variant={skelVariant} width="60%" />
			</div>
			{#snippet controls()}
				<label>
					<span>variant</span>
					<select bind:value={skelVariant}>
						<option value="text">text</option>
						<option value="pill">pill</option>
						<option value="wide">wide</option>
					</select>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="Toast" note="Bar and icon colours come from AppToaster.">
			<div class="badge-row">
				<Button size="sm" onclick={() => toast.success('Instance created')}>success</Button>
				<Button size="sm" onclick={() => toast.error('devcontainer up failed')}>error</Button>
				<Button size="sm" ghost onclick={() => toast('Copied to clipboard')}>blank</Button>
			</div>
		</ComponentDemo>

		<ComponentDemo title="InstanceCard" note="Hover to raise the offset shadow.">
			<ul class="card-host">
				<InstanceCard
					instance={demoCard}
					editing={cardEditing}
					bind:editingName={cardEditingName}
					pending={cardPending ? 'rebuild' : null}
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
				<label><input type="checkbox" bind:checked={cardPending} /><span>busy</span></label>
				<label><input type="checkbox" bind:checked={cardEditing} /><span>renaming</span></label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo title="IdeBar" note="The active tab is a slab; the second tab pulses.">
			<IdeBar
				running={demoTabs}
				active={ideActive}
				attention={ideAttention}
				editingId={null}
				bind:editingName={ideEditingName}
				onreload={() => toast('reload (demo)')}
				onselect={(id) => (ideActive = id)}
				onstartrename={() => {}}
				oncommitrename={() => {}}
				oncancelrename={() => {}}
			/>
			{#snippet controls()}
				<label>
					<span>tab 2</span>
					<select bind:value={ideAttention['demo-2']}>
						<option value={null}>none</option>
						<option value="done">done</option>
						<option value="waiting">waiting</option>
					</select>
				</label>
			{/snippet}
		</ComponentDemo>

		<ComponentDemo
			title="FolderBrowser"
			note="Modal, scrim, warn strip — unreachable without Docker."
		>
			<Button size="sm" onclick={() => (pickerOpen = true)}>Open picker</Button>
			{#if pickerOpen}
				<FolderBrowser
					onpick={(source) => {
						pickerOpen = false;
						toast(`picked ${source}`);
					}}
					onclose={() => (pickerOpen = false)}
				/>
			{/if}
		</ComponentDemo>
	</div>
</main>

<style>
	.showcase {
		min-height: 100vh;
		max-width: 740px;
		margin: 0 auto;
		padding: 32px;
		background: var(--bg);
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
		background: var(--slab);
		color: var(--slab-ink);
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
		border: 1px solid var(--edge);
		padding: 5px 7px;
	}
	.showcase :global(.fields input[type='range']),
	.showcase :global(.fields input[type='checkbox']) {
		accent-color: var(--slab);
	}
	/* IdeLoader is an inset:0 overlay, so give it a sized, positioned stage. */
	.loader-stage {
		position: relative;
		width: 100%;
		height: 180px;
		border: 1px solid var(--rule-soft);
		overflow: hidden;
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
		background: var(--slab);
		color: var(--slab-ink);
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
	.skel-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}
	/* InstanceCard is an <li>; the dashboard's own grid is not in scope here. */
	.card-host {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
	}
	/* Exists only to be read by getComputedStyle, never to be seen. */
	.probe {
		position: absolute;
		width: 0;
		height: 0;
		visibility: hidden;
	}
	.swatch .chip {
		height: 44px;
		border: 1px solid transparent;
	}
	.swatch .chip.bordered {
		border-color: var(--rule-soft);
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
