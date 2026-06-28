<script lang="ts">
  import { ideUrl, type Instance } from '../types.ts';
  import { House, X } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';

  let { activeId, running }: { activeId: string; running: Instance[] } = $props();

  // Default to the requested instance when it's running, else the first running
  // one (e.g. arriving for an instance that has since stopped). Props are fixed
  // for the page's lifetime, so reading their initial value is intentional.
  // svelte-ignore state_referenced_locally
  const initial = running.some((i) => i.id === activeId) ? activeId : (running[0]?.id ?? '');
  let active = $state(initial);
  let closing = $state<string | null>(null);

  const activeInstance = $derived(running.find((i) => i.id === active));

  // Stop the container, then return to the dashboard (which reflects the new
  // state via its live stream). Navigating away tears down all the iframes too.
  async function stop(id: string) {
    closing = id;
    try {
      await fetch(`/api/instances/${id}/stop`, { method: 'POST' });
    } catch {
      /* navigate anyway — the dashboard shows the real state */
    }
    window.location.href = '/';
  }
</script>

<div class="shell">
  <header class="bar">
    <a class="home" href="/" title="All instances" aria-label="All instances"><House size={18} /></a>
    {#if running.length > 0}
      <nav class="tabs">
        {#each running as inst (inst.id)}
          <div class="tab" class:active={inst.id === active}>
            <button type="button" class="tab-label" onclick={() => (active = inst.id)} title={inst.name}>
              {inst.name}
            </button>
            <button
              type="button"
              class="tab-close"
              onclick={() => stop(inst.id)}
              disabled={closing === inst.id}
              title="Stop and close"
              aria-label="Stop {inst.name}"
            >
              <X size={13} />
            </button>
          </div>
        {/each}
      </nav>
    {/if}
    {#if activeInstance}
      <div class="who">
        <Avatar name={activeInstance.name} />
      </div>
    {/if}
  </header>

  {#if running.length === 0}
    <div class="empty">No running instances.</div>
  {:else}
    <div class="panes">
      {#each running as inst (inst.id)}
        <div class="pane" class:active={inst.id === active}>
          <!-- All running IDEs are mounted at once; inactive panes are hidden via
               CSS so their code-server connection and editor state stay alive. -->
          <iframe src={ideUrl(inst)} title={inst.name}></iframe>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .bar {
    display: flex;
    align-items: stretch;
    gap: 0;
    height: 44px;
    border-bottom: 1px solid var(--rule);
    background: var(--bg-card);
  }
  .home {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    flex: none;
    color: var(--ink);
    border-right: 1px solid var(--rule);
  }
  .home:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .who {
    display: inline-flex;
    align-items: center;
    margin-left: auto;
    padding: 0 8px;
    flex: none;
    border-left: 1px solid var(--rule);
  }
  .tabs {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    min-width: 0;
  }
  .tab {
    display: inline-flex;
    align-items: stretch;
    border-right: 1px solid var(--rule-soft);
  }
  .tab.active {
    background: var(--ink);
  }
  .tab-label,
  .tab-close {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--ink-soft);
    font-family: var(--font-mono);
  }
  .tab-label {
    padding: 0 8px 0 16px;
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tab-close {
    display: inline-flex;
    align-items: center;
    padding: 0 10px 0 4px;
    color: var(--ink-faint);
  }
  .tab-close:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tab:not(.active) .tab-label:hover,
  .tab:not(.active) .tab-close:not(:disabled):hover {
    color: var(--ink);
  }
  .tab.active .tab-label,
  .tab.active .tab-close {
    color: var(--bg);
  }
  .tab.active .tab-close:not(:disabled):hover {
    opacity: 0.65;
  }
  .panes {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .pane {
    position: absolute;
    inset: 0;
  }
  .pane:not(.active) {
    display: none;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-faint);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 13px;
  }
</style>
