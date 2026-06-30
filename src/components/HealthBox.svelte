<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import type { InstanceHealth } from '../types.ts';

  let {
    health = null,
    lastFetchedAt = null,
  }: {
    /** Latest health snapshot, or null while the first check is pending. */
    health?: InstanceHealth | null;
    /** Epoch ms of the last successful health fetch, for the "updated Ns ago" readout. */
    lastFetchedAt?: number | null;
  } = $props();

  // One row per check: a pass/fail flag plus a uniform value word — "OK" when
  // passing, "—" otherwise (the tick/cross icon already conveys pass vs fail).
  const checks = $derived.by((): { label: string; ok: boolean; value: string }[] => {
    if (!health) return [];
    const v = (ok: boolean) => ({ ok, value: ok ? 'OK' : '—' });
    return [
      { label: 'Container running', ...v(health.containerRunning) },
      { label: 'Code-server reachable', ...v(health.codeServerAccessible) },
      // One row per injection that reports health (e.g. Claude Code, GitHub CLI, Claude hooks).
      ...health.injections.map((i) => ({ label: i.label, ...v(i.ok) })),
    ];
  });

  // Tick a local clock so the "updated Ns ago" readout counts up between polls.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const agoLabel = $derived.by(() => {
    if (!lastFetchedAt) return 'Waiting for first check…';
    const secs = Math.max(0, Math.round((now - lastFetchedAt) / 1000));
    return `Updated ${secs}s ago`;
  });
</script>

<div class="healthwrap">
  <div class="bar">Health</div>
  <div class="health">
    {#if health}
      {#each checks as check (check.label)}
        <div class="hrow">
          <span class="box {check.ok ? 'ok' : 'bad'}">
            {#if check.ok}<Check size={12} strokeWidth={3} />{:else}<X size={12} strokeWidth={3} />{/if}
          </span>
          <span class="hlabel">{check.label}</span>
          <span class="hvalue">{check.value}</span>
        </div>
      {/each}
    {:else}
      {#each Array(4) as _, i (i)}
        <div class="hrow">
          <span class="box idle"></span>
          <span class="skel skel-narrow"></span>
          <span class="skel skel-pill"></span>
        </div>
      {/each}
    {/if}
  </div>
  <div class="hfoot">{agoLabel}</div>
</div>

<style>
  .healthwrap {
    border: 1px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
    overflow: hidden;
  }
  .bar {
    padding: 9px 14px;
    background: var(--ink);
    color: var(--bg);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .health {
    background: var(--bg-card);
    display: grid;
    grid-template-columns: max-content 1fr max-content;
    align-items: center;
  }
  .hrow {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid var(--rule-soft);
  }
  .hrow:first-child {
    border-top: none;
  }
  /* Pass = filled checkbox with a tick; fail = hollow box with a cross. */
  .box {
    width: 16px;
    height: 16px;
    border: 1px solid var(--ink);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink);
  }
  .box.ok {
    background: var(--ink);
    color: var(--bg);
  }
  .box.bad {
    background: transparent;
  }
  .box.idle {
    border-color: var(--ink-faint);
  }
  .hlabel {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-soft);
  }
  .hvalue {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
    justify-self: end;
  }
  .hfoot {
    padding: 7px 14px;
    border-top: 1px solid var(--rule-soft);
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: 11px;
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
  .skel-narrow {
    width: 120px;
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
</style>
