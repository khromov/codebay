<script lang="ts">
  import { ideUrl, type Instance, type Preflight } from '../types.ts';
  import FolderBrowser from './FolderBrowser.svelte';

  let { preflight }: { preflight: Preflight } = $props();

  let instances = $state<Instance[]>([]);
  let loaded = $state(false);
  let browserOpen = $state(false);
  let creating = $state(false);
  let actionError = $state<string | null>(null);

  // svelte-ignore state_referenced_locally
  const ready = preflight.docker && preflight.cli;

  // Live instance list over SSE — the first message carries current state,
  // and the server pushes again on every change (boot progress, start/stop/delete).
  $effect(() => {
    const source = new EventSource('/api/instances/stream');
    source.onmessage = (event) => {
      try {
        instances = JSON.parse(event.data) as Instance[];
        loaded = true;
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => source.close();
  });

  async function createFrom(sourcePath: string) {
    browserOpen = false;
    creating = true;
    actionError = null;
    try {
      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath }),
      });
      const data = (await res.json()) as { instance?: Instance; error?: { message: string } };
      if (!res.ok || !data.instance) throw new Error(data.error?.message ?? 'Failed to create instance');
      // The SSE stream delivers the new instance; no manual insert needed.
    } catch (err) {
      actionError = (err as Error).message;
    } finally {
      creating = false;
    }
  }

  async function act(id: string, action: 'start' | 'stop' | 'delete') {
    actionError = null;
    if (action === 'delete' && !confirm('Delete this instance and its copied files?')) return;
    try {
      const res = await fetch(`/api/instances/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(data?.error?.message ?? `Failed to ${action}`);
      }
      // The SSE stream reflects the resulting state.
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  const statusLabel: Record<Instance['status'], string> = {
    creating: 'Booting…',
    running: 'Running',
    stopped: 'Stopped',
    error: 'Error',
  };
</script>

<header class="topbar">
  <div class="brand"><span class="logo">📦</span><span>Devcontainers Manager</span></div>
  <button class="primary" onclick={() => (browserOpen = true)} disabled={!ready || creating}>
    {creating ? 'Creating…' : '+ New instance'}
  </button>
</header>

<main class="stage">
  {#if !ready}
    <div class="banner error">
      <strong>Setup needed.</strong>
      {#if !preflight.docker}<span>Docker daemon is not reachable.</span>{/if}
      {#if !preflight.cli}<span>The devcontainer CLI is not available.</span>{/if}
    </div>
  {/if}

  {#if actionError}
    <div class="banner error"><strong>Error.</strong> <span>{actionError}</span></div>
  {/if}

  {#if !loaded}
    <div class="empty"><p class="empty-sub">Loading…</p></div>
  {:else if instances.length === 0}
    <div class="empty">
      <p class="empty-title">No instances yet</p>
      <p class="empty-sub">Pick a project folder to spin up an isolated devcontainer.</p>
      <button class="primary" onclick={() => (browserOpen = true)} disabled={!ready}>
        + New instance
      </button>
    </div>
  {:else}
    <ul class="grid">
      {#each instances as instance (instance.id)}
        <li class="card">
          <div class="card-head">
            <div class="name">{instance.name}</div>
            <span class="status {instance.status}">{statusLabel[instance.status]}</span>
          </div>
          <div class="path" title={instance.source_path}>{instance.source_path}</div>
          <div class="port">localhost:{instance.host_port}</div>
          {#if instance.status === 'error' && instance.error}
            <div class="card-error">{instance.error}</div>
          {/if}
          <div class="actions">
            {#if instance.status === 'running'}
              <a class="btn open" href={ideUrl(instance)} target="_blank" rel="noopener">
                Open IDE
              </a>
              <button class="btn" onclick={() => act(instance.id, 'stop')}>Stop</button>
            {:else if instance.status === 'stopped'}
              <button class="btn" onclick={() => act(instance.id, 'start')}>Start</button>
            {:else if instance.status === 'creating'}
              <a class="btn" href={`/instances/${instance.id}`}>View logs</a>
            {/if}
            <a class="btn ghost" href={`/instances/${instance.id}`}>Details</a>
            <button class="btn danger" onclick={() => act(instance.id, 'delete')}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if browserOpen}
  <FolderBrowser onpick={createFrom} onclose={() => (browserOpen = false)} />
{/if}

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
    border-bottom: 1px solid var(--rule);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 20px;
  }
  .stage {
    max-width: 1080px;
    margin: 0 auto;
    padding: 28px 24px 80px;
  }
  .banner {
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 20px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .banner.error {
    background: var(--red-100);
    color: var(--red-600);
  }
  .empty {
    text-align: center;
    padding: 80px 20px;
  }
  .empty-title {
    font-family: var(--font-serif);
    font-size: 24px;
    margin: 0 0 6px;
  }
  .empty-sub {
    color: var(--ink-soft);
    margin: 0 0 22px;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 18px;
  }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--rule);
    border-radius: 14px;
    padding: 18px 18px 16px;
    box-shadow: 0 18px 36px -28px rgba(42, 40, 37, 0.22);
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .name {
    font-weight: 600;
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .status.running {
    background: var(--green-100);
    color: var(--green-700);
  }
  .status.stopped {
    background: var(--rule);
    color: var(--ink-soft);
  }
  .status.creating {
    background: var(--amber-100);
    color: var(--amber-600);
  }
  .status.error {
    background: var(--red-100);
    color: var(--red-600);
  }
  .path {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .port {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-faint);
  }
  .card-error {
    margin-top: 10px;
    font-size: 12px;
    color: var(--red-600);
    background: var(--red-100);
    border-radius: 8px;
    padding: 8px 10px;
    max-height: 80px;
    overflow: auto;
  }
  .actions {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn {
    font: inherit;
    font-size: 13px;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--rule);
    background: #fff;
    color: var(--ink);
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover {
    border-color: var(--ink-faint);
  }
  .btn.open {
    background: var(--green-700);
    color: #fff;
    border-color: var(--green-700);
  }
  .btn.ghost {
    background: transparent;
  }
  .btn.danger {
    color: var(--red-600);
  }
  .btn.danger:hover {
    border-color: var(--red-600);
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
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
