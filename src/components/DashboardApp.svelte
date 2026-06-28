<script lang="ts">
  import { type Instance, type Preflight } from '../types.ts';
  import FolderBrowser from './FolderBrowser.svelte';
  import Avatar from './Avatar.svelte';
  import { Package, Check, TriangleAlert, X, Plus, GitBranch } from '@lucide/svelte';
  import toast, { Toaster } from 'svelte-french-toast';
  import type { AuthProvider } from '../types.ts';

  let { preflight }: { preflight: Preflight } = $props();

  let instances = $state<Instance[]>([]);
  let loaded = $state(false);
  let browserOpen = $state(false);
  let creating = $state(false);
  let actionError = $state<string | null>(null);
  let credOpen = $state(false);

  // svelte-ignore state_referenced_locally
  const ready = preflight.docker && preflight.cli;

  // Aggregate auth status: green when every provider is authorized, red when none
  // are, amber only in the mixed state (impossible until a second provider exists).
  const authedCount = $derived(preflight.auth.filter((a) => a.available).length);
  const credState = $derived(
    authedCount === preflight.auth.length ? 'ok' : authedCount === 0 ? 'error' : 'warn',
  );
  const credIcon = { ok: Check, warn: TriangleAlert, error: X } as const;
  const CredIcon = $derived(credIcon[credState]);

  function explainProvider(provider: AuthProvider) {
    if (provider.available) {
      toast.success(`${provider.label} credentials come from ${provider.source}.`);
    } else {
      const hint = provider.hint ? ` — ${provider.hint}` : '';
      toast.error(`No ${provider.label} credentials found${hint}.`);
    }
  }

  // Close the credentials dropdown on an outside click or Escape.
  $effect(() => {
    if (!credOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('.cred-menu')) credOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') credOpen = false;
    };
    // Defer registration so the click that opened the menu doesn't immediately close it.
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    };
  });

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
  <div class="brand"><span class="logo"><Package size={22} /></span><span>Devcontainers Manager</span></div>
  <div class="topbar-actions">
    <div class="cred-menu">
      <button
        class="cred {credState}"
        onclick={() => (credOpen = !credOpen)}
        aria-expanded={credOpen}
        aria-haspopup="menu"
        aria-label="Credentials"
        title="Credentials"
      >
        <CredIcon size={16} />
      </button>
      {#if credOpen}
        <div class="cred-dropdown" role="menu">
          {#each preflight.auth as provider (provider.id)}
            <button
              type="button"
              class="cred-row"
              role="menuitem"
              onclick={() => explainProvider(provider)}
              title={provider.available
                ? `Credentials from ${provider.source}, copied into each new instance.`
                : `No credentials found on this computer${provider.hint ? ` — ${provider.hint}` : ''}.`}
            >
              <span class="dot {provider.available ? 'on' : 'off'}"></span>
              <span class="cred-label">{provider.label}</span>
              <span class="cred-state">{provider.available ? 'Authorized' : 'Not found'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button class="btn danger" onclick={deleteAll} disabled={instances.length === 0}>
      Delete all
    </button>
    <button class="primary" onclick={() => (browserOpen = true)} disabled={!ready || creating}>
      {#if creating}Creating…{:else}<Plus size={15} /> New instance{/if}
    </button>
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
      <button class="primary" onclick={() => (browserOpen = true)} disabled={!ready}>
        <Plus size={15} /> New instance
      </button>
    </div>
  {:else}
    <ul class="grid">
      {#each instances as instance (instance.id)}
        <li class="card">
          <div class="card-head">
            <Avatar name={instance.name} />
            <div class="name">{instance.name}</div>
            <span class="status {instance.status}">{statusLabel[instance.status]}</span>
          </div>
          <div class="path" title={instance.source_path}>{instance.source_path}</div>
          <div class="port">localhost:{instance.host_port}</div>
          {#if instance.git_branch}
            <div class="branch" title="Branch checked out in the container">
              <GitBranch size={12} /><span>{instance.git_branch}</span>
            </div>
          {/if}
          {#if instance.status === 'error' && instance.error}
            <div class="card-error">{instance.error}</div>
          {/if}
          <div class="actions">
            {#if instance.status === 'running'}
              <a class="btn open" href={`/ide/${instance.id}`}>Open IDE</a>
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
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 11px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 22px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .logo {
    display: inline-flex;
    align-items: center;
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
  .cred-menu {
    position: relative;
    display: inline-flex;
  }
  .cred {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    font-size: 14px;
    line-height: 1;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--bg);
    cursor: pointer;
  }
  .cred:hover {
    background: var(--bg);
    color: var(--ink);
  }
  /* Auth states differ by fill pattern, not hue: ok = solid, warn = hatch,
     error = outline-only. */
  .cred.warn {
    background:
      repeating-linear-gradient(45deg, var(--ink) 0 2px, var(--bg) 2px 5px);
    color: var(--bg);
  }
  .cred.error {
    background: var(--bg);
    color: var(--ink);
  }
  .cred-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    min-width: 220px;
    padding: 6px;
    background: var(--bg-card);
    border: 1px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
  }
  .cred-row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 7px 9px;
    border: 0;
    background: transparent;
    color: var(--ink);
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .cred-row:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .cred-row:hover .cred-state {
    color: var(--bg);
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border: 1px solid currentColor;
  }
  .dot.on {
    background: currentColor;
  }
  .dot.off {
    background: transparent;
  }
  .cred-state {
    margin-left: auto;
    color: var(--ink-soft);
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
  .card {
    background: var(--bg-card);
    border: 1px solid var(--ink);
    padding: 16px 16px 14px;
    box-shadow: 4px 4px 0 var(--ink);
    transition: transform 0.08s steps(2), box-shadow 0.08s steps(2);
  }
  .card:hover {
    transform: translate(-1px, -1px);
    box-shadow: 6px 6px 0 var(--ink);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 11px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Monochrome theme: status reads via fill/pattern/animation, not hue. */
  .status {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 7px;
    border: 1px solid var(--ink);
    white-space: nowrap;
  }
  .status.running {
    background: var(--ink);
    color: var(--bg);
  }
  .status.stopped {
    background: transparent;
    color: var(--ink-soft);
    border-color: var(--ink-faint);
  }
  .status.creating {
    background: var(--ink);
    color: var(--bg);
    animation: lcd-blink 1.1s steps(1) infinite;
  }
  .status.error {
    background: repeating-linear-gradient(
      45deg,
      var(--ink) 0 3px,
      transparent 3px 6px
    );
    color: var(--ink);
    border-width: 2px;
    font-weight: 700;
  }
  @keyframes lcd-blink {
    50% {
      background: transparent;
      color: var(--ink);
    }
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
  .branch {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    border: 1px solid var(--ink-faint);
    padding: 2px 7px;
  }
  .branch :global(svg) {
    flex: none;
  }
  .branch span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-error {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--ink);
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
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 7px 12px;
    border: 1px solid var(--ink);
    background: var(--bg-card);
    color: var(--ink);
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn:disabled:hover {
    background: var(--bg-card);
    color: var(--ink);
  }
  .btn.open {
    background: var(--ink);
    color: var(--bg);
  }
  .btn.open:hover {
    background: var(--bg-card);
    color: var(--ink);
  }
  .btn.ghost {
    background: transparent;
    border-style: dashed;
  }
  .btn.ghost:hover {
    background: var(--ink);
    color: var(--bg);
    border-style: solid;
  }
  .btn.danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .btn.danger:hover:not(:disabled) {
    color: var(--danger);
    background-color: var(--danger-soft);
    border-color: transparent;
    /* Slowly marching red "ants" border, drawn as four animated edge gradients. */
    background-image:
      linear-gradient(90deg, var(--danger) 50%, transparent 0),
      linear-gradient(90deg, var(--danger) 50%, transparent 0),
      linear-gradient(0deg, var(--danger) 50%, transparent 0),
      linear-gradient(0deg, var(--danger) 50%, transparent 0);
    background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
    background-size: 14px 2px, 14px 2px, 2px 14px, 2px 14px;
    background-position: 0 0, 0 100%, 0 0, 100% 0;
    animation: marching-ants 2s linear infinite;
  }
  @keyframes marching-ants {
    to {
      background-position: 28px 0, -28px 100%, 0 -28px, 100% 28px;
    }
  }
  .primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
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
  }
  .primary:hover:not(:disabled) {
    background: var(--bg-card);
    color: var(--ink);
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
