<script lang="ts">
  import type { BrowseResult, FolderHistoryEntry } from '../types.ts';

  let { onpick, onclose }: { onpick: (path: string) => void; onclose: () => void } = $props();

  let result = $state<BrowseResult | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let query = $state('');
  let history = $state<FolderHistoryEntry[]>([]);
  let showAll = $state(false);

  const filtered = $derived(
    result
      ? result.entries.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
      : [],
  );

  const shownHistory = $derived(showAll ? history : history.slice(0, 5));

  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const data = (await res.json()) as { history?: FolderHistoryEntry[] };
      history = data.history ?? [];
    } catch {
      /* history is a convenience; ignore failures */
    }
  }

  async function removeHistory(path: string) {
    const prev = history;
    history = history.filter((h) => h.source_path !== path);
    try {
      await fetch('/api/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: path }),
      });
    } catch {
      history = prev; // restore on failure
    }
  }

  async function load(path: string | null = null) {
    loading = true;
    errorMsg = null;
    query = '';
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
      const res = await fetch(url);
      const data = (await res.json()) as BrowseResult & { error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'Could not list folder');
      result = data;
    } catch (err) {
      errorMsg = (err as Error).message;
    } finally {
      loading = false;
    }
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
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Pick a project folder"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => {}}
  >
    <div class="head">
      <h2>Pick a project folder</h2>
      <button class="x" onclick={onclose} aria-label="Close">✕</button>
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
              <span class="icon">🗂️</span>
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
              ✕
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
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <div class="list">
      {#if loading}
        <div class="muted">Loading…</div>
      {:else if errorMsg}
        <div class="muted err">{errorMsg}</div>
      {:else if result}
        {#if result.parent && !query}
          <button class="row up" onclick={() => load(result?.parent ?? null)}>
            <span class="icon">↑</span> ..
          </button>
        {/if}
        {#if filtered.length === 0}
          <div class="muted">{query ? 'No folders match.' : 'No subfolders here.'}</div>
        {/if}
        {#each filtered as entry (entry.path)}
          <div class="row">
            <button class="nav" onclick={() => load(entry.path)}>
              <span class="icon">📁</span>
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
        ⚠ No <code>devcontainer.json</code> in this folder — a default image will be used if you select it.
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
    background: rgba(42, 40, 37, 0.4);
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
    border: 1px solid var(--rule);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 40px 80px -30px rgba(42, 40, 37, 0.5);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--rule);
  }
  .head h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 18px;
  }
  .x {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 15px;
    color: var(--ink-soft);
  }
  .crumbs {
    padding: 10px 18px;
    border-bottom: 1px solid var(--rule);
    overflow: auto;
  }
  .crumbs code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .recent {
    padding: 8px;
    border-bottom: 1px solid var(--rule);
    max-height: 220px;
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
    background: var(--green-100);
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
    border: none;
    background: var(--bg-card);
    color: var(--ink-soft);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 5px 7px;
    border-radius: 6px;
    opacity: 0;
  }
  .recent-row:hover .recent-x {
    opacity: 1;
  }
  .recent-x:hover {
    color: var(--red-600);
    background: var(--green-100);
  }
  .recent-toggle {
    margin: 4px 6px 2px;
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    color: var(--green-700);
    padding: 4px 6px;
  }
  .recent-toggle:hover {
    text-decoration: underline;
  }
  .search {
    padding: 10px 18px;
    border-bottom: 1px solid var(--rule);
  }
  .search input {
    width: 100%;
    font: inherit;
    font-size: 13px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--rule);
    background: #fff;
    color: var(--ink);
  }
  .search input:focus {
    outline: none;
    border-color: var(--green-600);
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
  }
  .row .nav,
  .row.up {
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
  .row .nav:hover,
  .row.up:hover {
    background: var(--green-100);
  }
  .ename {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--green-700);
    background: var(--green-100);
    padding: 2px 6px;
    border-radius: 999px;
  }
  .pick-inline {
    font: inherit;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 7px;
    border: 1px solid var(--rule);
    background: #fff;
    cursor: pointer;
    color: var(--green-700);
  }
  .pick-inline:hover {
    border-color: var(--green-700);
  }
  .muted {
    padding: 18px;
    color: var(--ink-faint);
    text-align: center;
  }
  .muted.err {
    color: var(--red-600);
  }
  .warn {
    padding: 10px 18px;
    background: var(--amber-100);
    color: var(--amber-600);
    font-size: 12.5px;
    border-top: 1px solid var(--rule);
  }
  .warn code {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: rgba(154, 106, 30, 0.12);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-top: 1px solid var(--rule);
  }
  .hint {
    font-size: 12px;
    color: var(--ink-faint);
  }
  .primary {
    font: inherit;
    font-weight: 600;
    font-size: 14px;
    padding: 9px 16px;
    border-radius: 10px;
    border: 1px solid var(--green-700);
    background: var(--green-700);
    color: #fff;
    cursor: pointer;
    white-space: nowrap;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .icon {
    font-size: 14px;
  }
</style>
