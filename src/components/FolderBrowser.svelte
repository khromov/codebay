<script lang="ts">
  import type { BrowseResult } from '../types.ts';

  let { onpick, onclose }: { onpick: (path: string) => void; onclose: () => void } = $props();

  let result = $state<BrowseResult | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  async function load(path: string | null = null) {
    loading = true;
    errorMsg = null;
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

    <div class="list">
      {#if loading}
        <div class="muted">Loading…</div>
      {:else if errorMsg}
        <div class="muted err">{errorMsg}</div>
      {:else if result}
        {#if result.parent}
          <button class="row up" onclick={() => load(result?.parent ?? null)}>
            <span class="icon">↑</span> ..
          </button>
        {/if}
        {#if result.entries.length === 0}
          <div class="muted">No subfolders here.</div>
        {/if}
        {#each result.entries as entry (entry.path)}
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
