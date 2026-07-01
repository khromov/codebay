<script lang="ts">
  import { type Instance, type Preflight } from '../types.ts';
  import FolderBrowser from './FolderBrowser.svelte';
  import InstanceCard from './InstanceCard.svelte';
  import TopBar from './TopBar.svelte';
  import Button from './Button.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import { Toaster } from 'svelte-french-toast';
  import { apiPost } from '../api.ts';

  // Instances and their load state come from the persistent AppShell (single SSE
  // subscription shared with the IDE view); this component is presentational.
  let {
    preflight,
    instances,
    loaded,
  }: { preflight: Preflight; instances: Instance[]; loaded: boolean } = $props();

  let browserOpen = $state(false);
  let creating = $state(false);
  let actionError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  const ready = $derived(preflight.docker && preflight.cli);

  async function createFrom(sourcePath: string) {
    browserOpen = false;
    creating = true;
    actionError = null;
    try {
      await apiPost('/api/instances', { sourcePath }, 'Failed to create instance');
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
      await apiPost(`/api/instances/${id}/${action}`, undefined, `Failed to ${action}`);
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
      await apiPost(`/api/instances/${id}/rename`, { name }, 'Failed to rename');
      // The SSE stream reflects the new name.
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  async function deleteAll() {
    actionError = null;
    if (!confirm(`Delete all ${instances.length} instances and their copied files?`)) return;
    try {
      await apiPost('/api/instances/delete-all', undefined, 'Failed to delete all');
      // The SSE stream reflects the resulting empty state.
    } catch (err) {
      actionError = (err as Error).message;
    }
  }
</script>

<TopBar
  auth={preflight.auth}
  canDelete={instances.length > 0}
  {ready}
  {creating}
  onNew={() => (browserOpen = true)}
  onDeleteAll={deleteAll}
/>

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
      'border:1px solid var(--ink); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--ink); font-family:var(--font-mono); font-size:13px;',
  }}
/>

<style>
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
