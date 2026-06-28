<script lang="ts">
  import { type Instance, type Preflight } from '../types.ts';
  import FolderBrowser from './FolderBrowser.svelte';
  import InstanceCard from './InstanceCard.svelte';
  import SettingsCog from './SettingsCog.svelte';
  import CredMenu from './CredMenu.svelte';
  import Button from './Button.svelte';
  import Brand from './Brand.svelte';
  import { Plus } from '@lucide/svelte';
  import { Toaster } from 'svelte-french-toast';

  let { preflight }: { preflight: Preflight } = $props();

  let instances = $state<Instance[]>([]);
  let loaded = $state(false);
  let browserOpen = $state(false);
  let creating = $state(false);
  let actionError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingName = $state('');

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

  function startRename(instance: Instance) {
    editingId = instance.id;
    editingName = instance.name;
  }

  function cancelRename() {
    editingId = null;
    editingName = '';
  }

  async function commitRename(id: string) {
    const name = editingName.trim();
    const original = instances.find((i) => i.id === id)?.name;
    // Nothing to do on an empty or unchanged name — just close the editor.
    if (!name || name === original) {
      cancelRename();
      return;
    }
    cancelRename();
    actionError = null;
    try {
      const res = await fetch(`/api/instances/${id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(data?.error?.message ?? 'Failed to rename');
      }
      // The SSE stream reflects the new name.
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  async function deleteAll() {
    actionError = null;
    if (!confirm(`Delete all ${instances.length} instances and their copied files?`)) return;
    try {
      const res = await fetch('/api/instances/delete-all', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(data?.error?.message ?? 'Failed to delete all');
      }
      // The SSE stream reflects the resulting empty state.
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
  <Brand />
  <div class="topbar-actions">
    <SettingsCog />
    <CredMenu auth={preflight.auth} />
    <Button variant="danger" size="sm" onclick={deleteAll} disabled={instances.length === 0}>
      Delete all
    </Button>
    <Button
      variant="primary"
      icon={creating ? undefined : Plus}
      onclick={() => (browserOpen = true)}
      disabled={!ready || creating}
    >
      {creating ? 'Creating…' : 'New instance'}
    </Button>
  </div>
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
      <Button variant="primary" icon={Plus} onclick={() => (browserOpen = true)} disabled={!ready}>
        New instance
      </Button>
    </div>
  {:else}
    <ul class="grid">
      {#each instances as instance (instance.id)}
        <InstanceCard
          {instance}
          {statusLabel}
          editing={editingId === instance.id}
          bind:editingName
          onact={(action) => act(instance.id, action)}
          onstartrename={() => startRename(instance)}
          oncommitrename={() => commitRename(instance.id)}
          oncancelrename={cancelRename}
        />
      {/each}
    </ul>
  {/if}
</main>

{#if browserOpen}
  <FolderBrowser onpick={createFrom} onclose={() => (browserOpen = false)} />
{/if}

<Toaster
  toastOptions={{
    style:
      'border:1px solid #14150f; background:#e7e8e2; color:#14150f; box-shadow:4px 4px 0 #14150f; font-family:var(--font-mono); font-size:13px;',
  }}
/>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 28px;
    border-bottom: 1px solid var(--rule);
  }
  .stage {
    max-width: 1080px;
    margin: 0 auto;
    padding: 28px 24px 80px;
  }
  .banner {
    padding: 12px 16px;
    margin-bottom: 20px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .banner.error {
    background: var(--bg-card);
    color: var(--ink);
    border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
  }
  .topbar-actions {
    display: inline-flex;
    align-items: center;
    gap: 14px;
  }
  .empty {
    text-align: center;
    padding: 80px 20px;
  }
  .empty-title {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 8px;
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
</style>
