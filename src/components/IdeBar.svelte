<script lang="ts">
  import { type Instance } from '../types.ts';
  import { House, Settings } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';

  let {
    running,
    active,
    attention,
    onselect,
  }: {
    running: Instance[];
    active: string;
    attention: Record<string, 'done' | 'waiting' | null>;
    onselect: (id: string) => void;
  } = $props();
</script>

<header class="bar">
  <a class="home" href="/" title="All instances" aria-label="All instances"><House size={18} /></a>
  {#if running.length > 0}
    <nav class="tabs">
      {#each running as inst (inst.id)}
        <div
          class="tab"
          class:active={inst.id === active}
          class:attn-done={inst.id !== active && attention[inst.id] === 'done'}
          class:attn-waiting={inst.id !== active && attention[inst.id] === 'waiting'}
        >
          <button type="button" class="tab-label" onclick={() => onselect(inst.id)} title={inst.name}>
            <Avatar id={inst.id} name={inst.name} scale={4} />
            <span class="tab-name">{inst.name}</span>
          </button>
        </div>
      {/each}
    </nav>
  {/if}
  <a class="cog" href="/settings" title="Settings" aria-label="Settings"><Settings size={18} /></a>
</header>

<style>
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
  .cog {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    flex: none;
    margin-left: auto;
    color: var(--ink);
    border-left: 1px solid var(--rule);
  }
  .cog:hover {
    background: var(--ink);
    color: var(--bg);
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
  /* Attention pulse raised by the in-container Claude hook. The focused tab never
     gets these classes, so a pulsing tab always means "needs your eyes". */
  .tab.attn-done {
    animation: attn-pulse-green 1.8s ease-in-out infinite;
  }
  .tab.attn-waiting {
    animation: attn-pulse-amber 1.8s ease-in-out infinite;
  }
  @keyframes attn-pulse-green {
    0%,
    100% {
      background: transparent;
      box-shadow: inset 0 -2px 0 rgba(34, 197, 94, 0.4);
    }
    50% {
      background: rgba(34, 197, 94, 0.32);
      box-shadow: inset 0 -2px 0 rgba(34, 197, 94, 1);
    }
  }
  @keyframes attn-pulse-amber {
    0%,
    100% {
      background: transparent;
      box-shadow: inset 0 -2px 0 rgba(245, 158, 11, 0.4);
    }
    50% {
      background: rgba(245, 158, 11, 0.32);
      box-shadow: inset 0 -2px 0 rgba(245, 158, 11, 1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tab.attn-done,
    .tab.attn-waiting {
      animation-duration: 0s;
      background: rgba(34, 197, 94, 0.28);
    }
    .tab.attn-waiting {
      background: rgba(245, 158, 11, 0.28);
    }
  }
  .tab-label {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--ink-soft);
    font-family: var(--font-mono);
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    max-width: 240px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tab-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab:not(.active) .tab-label:hover {
    color: var(--ink);
  }
  .tab.active .tab-label {
    color: var(--bg);
  }
</style>
