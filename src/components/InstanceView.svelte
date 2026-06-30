<script lang="ts">
  import { ideUrl, type Instance, type InstanceHealth } from '../types.ts';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import HealthBox from './HealthBox.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import { liveSocket } from '../live.ts';
  import type { StreamEvent } from '../lib/instances.server.ts';

  let { id }: { id: string } = $props();

  let instance = $state<Instance | null>(null);
  let health = $state<InstanceHealth | null>(null);
  let lastFetchedAt = $state<number | null>(null);
  let logs = $state('');

  // Auto-scroll the log box to the bottom whenever new output is appended.
  // Runs after the DOM updates, so scrollHeight is fresh (no tick() needed).
  function autoscroll(node: HTMLDivElement) {
    logs; // re-run whenever new log output is appended
    node.scrollTop = node.scrollHeight;
  }

  // Stream the boot/build log over its dedicated WebSocket. Reset on (re)connect
  // so the server's buffer replay doesn't duplicate output after a reconnect.
  $effect(() =>
    liveSocket(
      `/api/instances/${id}/logs`,
      (chunk) => (logs += chunk),
      () => (logs = ''),
    ),
  );

  // Track this instance's status and health from the central live stream.
  $effect(() =>
    liveSocket('/api/stream', (raw) => {
      try {
        const msg = JSON.parse(raw) as StreamEvent;
        if (msg.type === 'instances') {
          const found = msg.data.find((i) => i.id === id);
          if (found) instance = found;
        } else if (msg.type === 'health' && msg.data.id === id) {
          health = msg.data.health;
          lastFetchedAt = Date.now();
        }
      } catch {
        /* ignore malformed frame */
      }
    }),
  );

  const url = $derived(instance ? ideUrl(instance) : '#');

  // --- Forwarded ports ------------------------------------------------------
  let newPort = $state('');
  let portError = $state<string | null>(null);
  // Set when the forward set changes this session; cleared once a rebuild applies it.
  let pendingRebuild = $state(false);
  const forwards = $derived(instance?.forwarded_ports ?? []);
  const building = $derived(instance?.status === 'creating');

  async function portAction(run: () => Promise<Response>): Promise<boolean> {
    portError = null;
    try {
      const res = await run();
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(data?.error?.message ?? 'Request failed');
      }
      return true;
    } catch (err) {
      portError = (err as Error).message;
      return false;
    }
  }

  async function addPort(e: Event) {
    e.preventDefault();
    const port = Number.parseInt(newPort, 10);
    if (!Number.isInteger(port)) {
      portError = 'Enter a port number';
      return;
    }
    const ok = await portAction(() =>
      fetch(`/api/instances/${id}/ports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      }),
    );
    if (ok) {
      newPort = '';
      pendingRebuild = true;
    }
  }

  async function removePort(port: number) {
    const ok = await portAction(() =>
      fetch(`/api/instances/${id}/ports/${port}`, { method: 'DELETE' }),
    );
    if (ok) pendingRebuild = true;
  }

  async function restart() {
    const ok = await portAction(() => fetch(`/api/instances/${id}/rebuild`, { method: 'POST' }));
    if (ok) pendingRebuild = false;
  }
</script>

<header class="topbar">
  <a class="back" href="/"><ArrowLeft size={15} /> All instances</a>
  <div class="title">
    <span class="name">{instance?.name ?? 'Instance'}</span>
    {#if instance}
      <StatusBadge status={instance.status} />
    {:else}
      <span class="skel skel-pill"></span>
    {/if}
  </div>
  {#if instance?.status === 'running'}
    <a class="open" href={url} target="_blank" rel="noopener">Open in new tab <ArrowUpRight size={15} /></a>
  {/if}
</header>

<main class="stage">
  <div class="meta">
    <span class="k">Source</span>
    {#if instance}<code>{instance.source_path}</code>{:else}<span class="skel skel-wide"></span>{/if}

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
      <span class="skel skel-wide"></span>
    {/if}
  </div>

  <div class="healthslot">
    <HealthBox {health} {lastFetchedAt} />
  </div>

  <section class="ports">
    <div class="ports-bar">
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
              <a href={`http://localhost:${f.host_port}`} target="_blank" rel="noopener"
                >localhost:{f.host_port} <ArrowUpRight size={12} /></a
              >
              <button class="rm" title="Remove" onclick={() => removePort(f.container_port)}>×</button>
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
        <p class="hint pending">Port changes apply when you <strong>Restart</strong> (recreates the container).</p>
      {/if}
      <p class="hint">Your app must bind to <code>0.0.0.0</code> inside the container to be reachable.</p>
    </div>
  </section>

  <div class="logwrap">
    <div class="logbar">Boot log</div>
    <div class="logs" {@attach autoscroll}><pre>{logs || 'Waiting for output…'}<span class="caret"></span></pre></div>
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
  .skel {
    display: inline-block;
    height: 0.95em;
    background: linear-gradient(90deg, var(--rule-soft) 25%, var(--bg-card) 50%, var(--rule-soft) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
    vertical-align: middle;
  }
  .skel-wide {
    width: min(420px, 60vw);
  }
  .skel-pill {
    width: 64px;
    height: 18px;
    border-radius: 999px;
  }
  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
  .healthslot {
    margin-bottom: 18px;
  }
  .ports {
    border: 1px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
    margin-bottom: 18px;
  }
  .ports-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 14px;
    background: var(--ink);
    color: var(--bg);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
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
    border: 1px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
    overflow: hidden;
  }
  .logbar {
    padding: 9px 14px;
    background: var(--ink);
    color: var(--bg);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  /* The one "screen": a black LCD panel with faint scanlines. */
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
  /* Blinking block cursor — the live-terminal tell. */
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
