<script lang="ts">
	import { tick } from 'svelte';
	import type { BrowseResult, FolderHistoryEntry } from '../types.ts';
	import { isRepoUrl } from '../lib/repo-url.ts';
	import X from '@lucide/svelte/icons/x';
	import FolderClock from '@lucide/svelte/icons/folder-clock';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Folder from '@lucide/svelte/icons/folder';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { apiFetch, apiDelete } from '../api.ts';

	let {
		onpick,
		onclose
	}: { onpick: (source: string, opts?: { branch?: string }) => void; onclose: () => void } =
		$props();

	let result = $state<BrowseResult | null>(null);
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);
	let query = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let history = $state<FolderHistoryEntry[]>([]);
	let showAll = $state(false);
	let repoUrl = $state('');
	let repoBranch = $state('');

	const repoValid = $derived(isRepoUrl(repoUrl));

	function cloneRepoUrl() {
		if (!repoValid) return;
		onpick(repoUrl.trim(), { branch: repoBranch.trim() || undefined });
	}

	const filtered = $derived(
		result
			? result.entries.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
			: []
	);

	const shownHistory = $derived(showAll ? history : history.slice(0, 5));

	async function loadHistory() {
		try {
			const data = await apiFetch<{ history?: FolderHistoryEntry[] }>('/api/history');
			history = data.history ?? [];
		} catch {
			/* history is a convenience; ignore failures */
		}
	}

	async function removeHistory(path: string) {
		const prev = history;
		history = history.filter((h) => h.source_path !== path);
		try {
			await apiDelete('/api/history', { sourcePath: path });
		} catch {
			history = prev; // restore on failure (network error, or a non-2xx response)
		}
	}

	async function load(path: string | null = null) {
		loading = true;
		errorMsg = null;
		query = '';
		try {
			const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
			result = await apiFetch<BrowseResult>(url, undefined, 'Could not list folder');
		} catch (err) {
			errorMsg = (err as Error).message;
		} finally {
			loading = false;
		}
		await tick();
		searchInput?.focus();
	}

	$effect(() => {
		load();
		loadHistory();
	});
</script>

<div
	class="overlay"
	role="button"
	tabindex="0"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
>
	<div
		class="modal panel"
		role="dialog"
		aria-modal="true"
		aria-label="Pick a project folder"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={() => {}}
	>
		<div class="head">
			<h2>Pick a project folder</h2>
			<button class="x" onclick={onclose} aria-label="Close"><X size={16} /></button>
		</div>

		<div class="clone">
			<div class="clone-label">Clone a Git repository</div>
			<div class="clone-row">
				<input
					class="clone-url"
					type="text"
					placeholder="https://github.com/owner/repo"
					bind:value={repoUrl}
					spellcheck="false"
					autocomplete="off"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							cloneRepoUrl();
						}
					}}
				/>
				<input
					class="clone-branch"
					type="text"
					placeholder="branch (optional)"
					bind:value={repoBranch}
					spellcheck="false"
					autocomplete="off"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							cloneRepoUrl();
						}
					}}
				/>
				<button class="clone-btn" disabled={!repoValid} onclick={cloneRepoUrl}>Clone</button>
			</div>
		</div>

		<div class="crumbs">
			<code>{result?.path ?? '…'}</code>
		</div>

		{#if history.length > 0}
			<div class="recent">
				<div class="recent-label">Recent</div>
				{#each shownHistory as entry (entry.source_path)}
					<div class="recent-row">
						<button class="recent-pick" onclick={() => onpick(entry.source_path)}>
							<span class="icon">
								{#if isRepoUrl(entry.source_path)}<GitBranch size={16} />{:else}<FolderClock
										size={16}
									/>{/if}
							</span>
							<span class="recent-text">
								<span class="recent-name">{entry.name}</span>
								<span class="recent-path">{entry.source_path}</span>
							</span>
						</button>
						<button
							class="recent-x"
							aria-label="Remove {entry.name} from history"
							title="Remove from history"
							onclick={(e) => {
								e.stopPropagation();
								removeHistory(entry.source_path);
							}}
						>
							<X size={14} />
						</button>
					</div>
				{/each}
				{#if history.length > 5}
					<button class="recent-toggle" onclick={() => (showAll = !showAll)}>
						{showAll ? 'Show fewer' : `Show all (${history.length})`}
					</button>
				{/if}
			</div>
		{/if}

		<div class="search">
			<input
				type="text"
				placeholder="Filter folders…"
				bind:value={query}
				bind:this={searchInput}
				spellcheck="false"
				autocomplete="off"
				onkeydown={(e) => {
					const first = filtered[0];
					if (e.key === 'Enter' && first) {
						e.preventDefault();
						load(first.path);
					}
				}}
			/>
		</div>

		<div class="list">
			{#if loading}
				<div class="muted">Loading…</div>
			{:else if errorMsg}
				<div class="muted err">{errorMsg}</div>
			{:else if result}
				{#if result.parent && !query}
					<div class="row">
						<button class="nav" onclick={() => load(result?.parent ?? null)}>
							<span class="icon"><ArrowUp size={16} /></span>
							<span class="ename">..</span>
						</button>
					</div>
				{/if}
				{#if filtered.length === 0}
					<div class="muted">{query ? 'No folders match.' : 'No subfolders here.'}</div>
				{/if}
				{#each filtered as entry, i (entry.path)}
					<div class="row" class:first-match={query.trim() && i === 0}>
						<button class="nav" onclick={() => load(entry.path)}>
							<span class="icon"><Folder size={16} /></span>
							<span class="ename">{entry.name}</span>
							{#if entry.hasDevcontainer}<span class="badge">devcontainer</span>{/if}
						</button>
						<button class="pick-inline" onclick={() => onpick(entry.path)}>Select</button>
					</div>
				{/each}
			{/if}
		</div>

		{#if result && !result.hasDevcontainer}
			<div class="warn">
				<TriangleAlert size={15} />
				<span
					>No <code>devcontainer.json</code> in this folder — a default image will be used if you select
					it.</span
				>
			</div>
		{/if}

		<div class="foot">
			<span class="hint">Browse to a folder, then select this folder or any subfolder.</span>
			<button class="primary" disabled={!result} onclick={() => result && onpick(result.path)}>
				Select this folder
			</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--ink) 50%, transparent);
		display: grid;
		place-items: center;
		padding: 24px;
		z-index: 50;
	}
	.modal {
		width: min(620px, 100%);
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-card);
		overflow: hidden;
		box-shadow: 8px 8px 0 var(--ink);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid var(--ink);
		background: var(--ink);
	}
	.head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--bg);
	}
	.x {
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		cursor: pointer;
		color: var(--bg);
	}
	.x:hover {
		opacity: 0.7;
	}
	.clone {
		padding: 12px 18px;
		border-bottom: 1px solid var(--rule-soft);
	}
	.clone-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
		padding-bottom: 6px;
	}
	.clone-row {
		display: flex;
		gap: 8px;
	}
	.clone-url,
	.clone-branch {
		font-family: var(--font-mono);
		font-size: 13px;
		padding: 8px 12px;
		border: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
	}
	.clone-url {
		flex: 1;
		min-width: 0;
	}
	.clone-branch {
		width: 140px;
		flex: none;
	}
	.clone-url::placeholder,
	.clone-branch::placeholder {
		color: var(--ink-faint);
	}
	.clone-url:focus,
	.clone-branch:focus {
		outline: none;
		box-shadow: inset 3px 3px 0 var(--rule-soft);
	}
	.clone-btn {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 8px 14px;
		border: 1px solid var(--ink);
		background: var(--ink);
		color: var(--bg);
		cursor: pointer;
		white-space: nowrap;
	}
	.clone-btn:hover:not(:disabled) {
		background: var(--bg-card);
		color: var(--ink);
	}
	.clone-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.crumbs {
		padding: 10px 18px;
		border-bottom: 1px solid var(--rule-soft);
		overflow-x: auto;
		overflow-y: hidden;
		/* Reserve a full line so the path isn't clipped by the horizontal scrollbar. */
		min-height: 18px;
		flex-shrink: 0;
	}
	.crumbs code {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
		white-space: nowrap;
	}
	.recent {
		padding: 8px;
		border-bottom: 1px solid var(--rule-soft);
		/* Don't let the folder list squish this; grow with content up to ~half the
       picker, then scroll. */
		flex-shrink: 0;
		max-height: 40vh;
		overflow: auto;
	}
	.recent-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
		padding: 2px 10px 6px;
	}
	.recent-row {
		position: relative;
		display: flex;
		align-items: center;
	}
	.recent-pick {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		padding: 8px 10px;
		border: none;
		background: none;
		cursor: pointer;
		font: inherit;
		text-align: left;
		border-radius: 8px;
		color: var(--ink);
	}
	.recent-pick:hover {
		background: var(--ink);
		color: var(--bg);
	}
	.recent-pick:hover .recent-path {
		color: var(--bg);
	}
	.recent-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.recent-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recent-path {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recent-x {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		border: none;
		background: var(--bg-card);
		color: var(--ink-soft);
		cursor: pointer;
		line-height: 1;
		padding: 5px 7px;
		border-radius: 6px;
		opacity: 0;
	}
	.recent-row:hover .recent-x {
		opacity: 1;
	}
	.recent-x:hover {
		color: var(--bg);
		background: var(--ink);
	}
	.recent-toggle {
		margin: 4px 6px 2px;
		border: none;
		background: none;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink);
		padding: 4px 6px;
	}
	.recent-toggle:hover {
		text-decoration: underline;
	}
	.search {
		padding: 10px 18px;
		border-bottom: 1px solid var(--rule-soft);
	}
	.search input {
		width: 100%;
		font-family: var(--font-mono);
		font-size: 13px;
		padding: 8px 12px;
		border: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
	}
	.search input::placeholder {
		color: var(--ink-faint);
	}
	.search input:focus {
		outline: none;
		box-shadow: inset 3px 3px 0 var(--rule-soft);
	}
	.list {
		flex: 1;
		overflow: auto;
		padding: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: 8px;
	}
	.row.first-match {
		border-color: var(--rule-soft);
	}
	.row .nav {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border: none;
		background: none;
		cursor: pointer;
		font: inherit;
		text-align: left;
		border-radius: 8px;
		color: var(--ink);
	}
	.row .nav:hover {
		background: var(--ink);
		color: var(--bg);
	}
	.row .nav:hover .icon {
		color: var(--bg);
	}
	.ename {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink);
		background: transparent;
		border: 1px solid var(--ink);
		padding: 2px 5px;
	}
	.row .nav:hover .badge {
		color: var(--bg);
		border-color: var(--bg);
	}
	.pick-inline {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 6px 10px;
		border: 1px solid var(--ink);
		background: var(--bg-card);
		cursor: pointer;
		color: var(--ink);
	}
	.pick-inline:hover {
		background: var(--ink);
		color: var(--bg);
	}
	.muted {
		padding: 18px;
		color: var(--ink-faint);
		text-align: center;
	}
	.muted.err {
		color: var(--ink);
		font-weight: 600;
	}
	.warn {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 18px;
		background: var(--warn-bg);
		color: var(--warn-ink);
		font-family: var(--font-mono);
		font-size: 12.5px;
		border-top: 1px solid var(--warn-line);
	}
	.warn :global(svg) {
		flex: none;
		margin-top: 1px;
	}
	.warn code {
		font-family: var(--font-mono);
		font-size: 0.9em;
		/* Intentional white glint to lift the code chip off the amber warn bg — not a palette token. */
		background: rgba(255, 255, 255, 0.35);
		border: 1px solid var(--warn-line);
		padding: 0 5px;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px;
		border-top: 1px solid var(--ink);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
	}
	.primary {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 9px 16px;
		border: 1px solid var(--ink);
		background: var(--ink);
		color: var(--bg);
		cursor: pointer;
		white-space: nowrap;
	}
	.primary:hover:not(:disabled) {
		background: var(--bg-card);
		color: var(--ink);
	}
	.primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		color: var(--ink-soft);
	}
</style>
