<script lang="ts">
	import { ideUrl, type Instance, type InstanceHealth } from '../types.ts';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import HealthBox from './HealthBox.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import Skeleton from './Skeleton.svelte';
	import { forwardedPortUrl } from '../lib/links.ts';
	import { liveSocket, liveStream } from '../live.ts';
	import { apiPost, apiDelete } from '../api.ts';
	import { enhance } from 'mochi-framework';
	import type { MochiEnhanceOptions } from 'mochi-framework';
	import { onBackLinkClick, installPopupBackTrap } from '../lib/popup-nav.ts';
	import { tick } from 'svelte';

	let { id, injectionChecks = 0 }: { id: string; injectionChecks?: number } = $props();

	let instance = $state<Instance | null>(null);
	let health = $state<InstanceHealth | null>(null);
	let lastFetchedAt = $state<number | null>(null);
	let logs = $state('');
	let logEl = $state<HTMLDivElement | null>(null);
	let following = $state(true);

	// Pin to the newest output whenever logs grow — but only while following.
	// tick() lets the <pre> text node grow before we scroll, so we reach the true bottom.
	$effect(() => {
		if (!following || logs.length === 0) return; // reading logs.length tracks appended chunks
		tick().then(() => {
			if (following) logEl?.scrollTo(0, logEl.scrollHeight);
		});
	});

	// A user scrolling up pauses following; programmatic scroll-to-bottom keeps the
	// gap ~0, so it never trips this — only re-clicking "Follow log" resumes.
	function onLogScroll() {
		if (!logEl) return;
		const gap = logEl.scrollHeight - logEl.clientHeight - logEl.scrollTop;
		if (gap > 40) following = false;
	}

	function toggleFollow() {
		following = !following;
		if (following) logEl?.scrollTo(0, logEl.scrollHeight);
	}

	$effect(() => installPopupBackTrap());

	// Reset on every connect, because the server replays its whole buffer each time.
	$effect(() =>
		liveSocket(
			`/api/instances/${id}/logs`,
			(chunk) => (logs += chunk),
			() => (logs = '')
		)
	);

	$effect(() =>
		liveStream((msg) => {
			if (msg.type === 'instances') {
				const found = msg.data.find((i) => i.id === id);
				if (found) instance = found;
			} else if (msg.type === 'health' && msg.data.id === id) {
				health = msg.data.health;
				lastFetchedAt = Date.now();
			}
		})
	);

	const url = $derived(instance ? ideUrl(instance) : '#');

	let newPort = $state('');
	let portError = $state<string | null>(null);
	// Set when the forward set changes this session; cleared once a rebuild applies it.
	let pendingRebuild = $state(false);
	const forwards = $derived(instance?.forwarded_ports ?? []);
	const building = $derived(instance?.status === 'creating');

	async function portAction(run: () => Promise<unknown>): Promise<boolean> {
		portError = null;
		try {
			await run();
			return true;
		} catch (err) {
			portError = (err as Error).message;
			return false;
		}
	}

	async function addPort(e: Event) {
		e.preventDefault();
		const port = Number.parseInt(newPort, 10);
		// Mirror the server's range check so an obviously-bad port is rejected without a round-trip.
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			portError = 'Enter a port number between 1 and 65535';
			return;
		}
		const ok = await portAction(() => apiPost(`/api/instances/${id}/ports`, { port }));
		if (ok) {
			newPort = '';
			pendingRebuild = true;
		}
	}

	async function removePort(port: number) {
		const ok = await portAction(() => apiDelete(`/api/instances/${id}/ports/${port}`));
		if (ok) pendingRebuild = true;
	}

	async function restart() {
		const ok = await portAction(() => apiPost(`/api/instances/${id}/rebuild`));
		if (ok) pendingRebuild = false;
	}

	let restartError = $state<string | null>(null);
	// Covers the click until the instance reaches `creating`, where `building` takes over.
	let restarting = $state(false);

	const restartOpts: MochiEnhanceOptions<Record<string, never>, { error: string }> = {
		onPending: (v) => (restarting = v),
		submit: () => {
			restartError = null;
			return ({ result }) => {
				if (result.type === 'failure') {
					restartError = result.data?.error ?? 'Restart failed';
				} else if (result.type === 'error') {
					restartError = 'Network error. Try again.';
				}
			};
		}
	};

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyLogs() {
		await navigator.clipboard.writeText(logs);
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 2000);
	}
</script>

<header class="topbar">
	<a class="back" href="/" onclick={onBackLinkClick}><ArrowLeft size={15} /> All instances</a>
	<div class="title">
		<span class="name">{instance?.name ?? 'Instance'}</span>
		{#if instance}
			<StatusBadge status={instance.status} />
		{:else}
			<Skeleton variant="pill" />
		{/if}
	</div>
	{#if instance?.status === 'running'}
		<form method="POST" action="?/restart" {@attach enhance(restartOpts)}>
			<button class="restart" type="submit" disabled={restarting || building}>
				{restarting || building ? 'Restarting…' : 'Restart container'}
			</button>
		</form>
		<a class="open" href={url} target="_blank" rel="noopener"
			>Open in new tab <ArrowUpRight size={15} /></a
		>
	{/if}
</header>
{#if restartError}<p class="restart-err">{restartError}</p>{/if}

<main class="stage">
	<div class="meta">
		<span class="k">Source</span>
		{#if instance}<code>{instance.source_path}</code>{:else}<Skeleton variant="wide" />{/if}

		<span class="k">Image</span>
		{#if instance}
			{#if instance.image_source === 'local'}
				<code>local (project devcontainer.json)</code>
			{:else if instance.image_source}
				<code>{instance.image_source}</code>
			{:else}
				<code class="muted">—</code>
			{/if}
		{:else}
			<Skeleton variant="wide" />
		{/if}
	</div>

	<div class="healthslot">
		<!-- Treat "instance not yet loaded from the stream" as active so the health
         panel shows the full skeleton (all expected rows) while loading, rather
         than the inactive 2-row fallback. Only a loaded, non-running instance is
         genuinely inactive. -->
		<HealthBox
			{health}
			{lastFetchedAt}
			{injectionChecks}
			active={!instance || instance.status === 'running'}
			mode={instance?.mode ?? 'ide'}
		/>
	</div>

	<section class="ports panel">
		<div class="ports-bar panel-bar">
			<span>Forwarded ports</span>
			{#if pendingRebuild}
				<button class="rebuild" onclick={restart} disabled={building}>
					{building ? 'Restarting…' : 'Restart to apply'}
				</button>
			{/if}
		</div>
		<div class="ports-body">
			{#if forwards.length}
				<ul class="port-list">
					{#each forwards as f (f.container_port)}
						<li>
							<span class="cp">:{f.container_port}</span>
							<span class="arr">→</span>
							<a href={forwardedPortUrl(f.host_port)} target="_blank" rel="noopener"
								>{forwardedPortUrl(f.host_port).replace('http://', '')}
								<ArrowUpRight size={12} /></a
							>
							<button class="rm" title="Remove" onclick={() => removePort(f.container_port)}
								>×</button
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">No ports forwarded yet.</p>
			{/if}

			<form class="add" onsubmit={addPort}>
				<input
					type="number"
					min="1"
					max="65535"
					placeholder="container port (e.g. 3000)"
					bind:value={newPort}
					spellcheck="false"
				/>
				<button type="submit">Add</button>
			</form>

			{#if portError}<p class="port-err">{portError}</p>{/if}
			{#if pendingRebuild}
				<p class="hint pending">
					Port changes apply when you <strong>Restart</strong> (recreates the container).
				</p>
			{/if}
			<p class="hint">
				Your app must bind to <code>0.0.0.0</code> inside the container to be reachable.
			</p>
		</div>
	</section>

	<div class="logwrap panel">
		<div class="log-bar panel-bar">
			<span>Boot log</span>
			<div class="log-actions">
				<button class="copy" class:active={following} onclick={toggleFollow}>
					{following ? 'Following' : 'Follow log'}
				</button>
				<button class="copy" onclick={copyLogs} disabled={!logs}>
					{copied ? 'Copied!' : 'Copy logs'}
				</button>
			</div>
		</div>
		<div class="logs" bind:this={logEl} onscroll={onLogScroll}>
			<pre>{logs || 'Waiting for output…'}<span class="caret"></span></pre>
		</div>
		{#if instance?.status === 'error' && instance.error}
			<div class="err">{instance.error}</div>
		{/if}
	</div>
</main>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 16px 24px;
		border-bottom: 1px solid var(--rule);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 12px;
	}
	.back:hover {
		color: var(--ink);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
	}
	.name {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 20px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.open {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink);
		text-decoration: none;
		border: 1px solid var(--ink);
		padding: 7px 12px;
	}
	.open:hover {
		background: var(--ink);
		color: var(--bg);
	}
	.restart {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--ink);
		padding: 7px 12px;
		cursor: pointer;
	}
	.restart:hover:not(:disabled) {
		background: var(--ink);
		color: var(--bg);
	}
	.restart:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.restart-err {
		margin: 0;
		padding: 8px 24px 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
	}
	.stage {
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px 24px 40px;
	}
	.meta {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 14px;
		align-items: center;
		margin-bottom: 18px;
	}
	.meta .k {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.meta code {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--ink-soft);
	}
	.meta code.muted {
		color: var(--ink-faint);
	}
	.healthslot {
		margin-bottom: 18px;
	}
	.ports {
		margin-bottom: 18px;
	}
	.ports-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.rebuild {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 4px 9px;
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--bg);
		cursor: pointer;
	}
	.rebuild:hover:not(:disabled) {
		background: transparent;
		color: var(--bg);
	}
	.rebuild:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.ports-body {
		padding: 12px 14px 14px;
		background: var(--bg-card);
	}
	.port-list {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.port-list li {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.port-list .cp {
		font-weight: 600;
		color: var(--ink);
	}
	.port-list .arr {
		color: var(--ink-faint);
	}
	.port-list a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--ink);
		text-decoration: none;
		border-bottom: 1px solid var(--ink-faint);
	}
	.port-list a:hover {
		border-bottom-color: var(--ink);
	}
	.rm {
		margin-left: auto;
		width: 20px;
		height: 20px;
		line-height: 1;
		font-size: 15px;
		border: 1px solid var(--ink-faint);
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.rm:hover {
		border-color: var(--danger);
		color: var(--danger);
	}
	.empty {
		margin: 0 0 12px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
	}
	.add {
		display: flex;
		gap: 8px;
	}
	.add input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 13px;
		padding: 6px 9px;
		border: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		outline: none;
	}
	.add button {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 6px 14px;
		border: 1px solid var(--ink);
		background: var(--bg-card);
		color: var(--ink);
		cursor: pointer;
	}
	.add button:hover {
		background: var(--ink);
		color: var(--bg);
	}
	.port-err {
		margin: 10px 0 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
	}
	.hint {
		margin: 10px 0 0;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
	}
	.hint.pending {
		color: var(--ink-soft);
	}
	.hint code {
		color: var(--ink);
	}
	.logwrap {
		overflow: hidden;
	}
	.log-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.log-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.copy {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 4px 9px;
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--bg);
		cursor: pointer;
	}
	.copy:hover:not(:disabled) {
		background: transparent;
		color: var(--bg);
	}
	.copy.active {
		background: transparent;
		color: var(--bg);
	}
	.copy:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.logs {
		position: relative;
		background:
			repeating-linear-gradient(0deg, var(--screen-line) 0 1px, transparent 1px 3px),
			var(--screen-bg);
		color: var(--screen-ink);
		padding: 14px;
		height: calc(100vh - 320px);
		min-height: 360px;
		overflow: auto;
	}
	.logs pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12.5px;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}
	/* Duplicated from StatusBadge because Svelte scopes `@keyframes` per component,
	   so a keyframe defined elsewhere never resolves here. */
	@keyframes lcd-blink {
		50% {
			background: transparent;
		}
	}
	.caret {
		display: inline-block;
		width: 0.6em;
		height: 1.05em;
		margin-left: 2px;
		background: var(--screen-ink);
		vertical-align: text-bottom;
		animation: lcd-blink 1.05s steps(1) infinite;
	}
	.err {
		padding: 12px 14px;
		background: var(--bg-card);
		color: var(--ink);
		border-top: 2px solid var(--ink);
		font-family: var(--font-mono);
		font-size: 13px;
	}
</style>
