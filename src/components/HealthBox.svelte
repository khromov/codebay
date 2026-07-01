<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import type { InstanceHealth } from '../types.ts';
  import Skeleton from './Skeleton.svelte';

  // The two checks intrinsic to every instance, independent of any injection.
  // Shown live, as the inactive fallback, and counted toward the skeleton rows.
  const FIXED_CHECKS = ['Container running', 'Code-server reachable'] as const;

  let {
    health = null,
    lastFetchedAt = null,
    active = true,
    injectionChecks = 0,
  }: {
    /** Latest health snapshot, or null while the first check is pending. */
    health?: InstanceHealth | null;
    /** Epoch ms of the last successful health fetch, for the "updated Ns ago" readout. */
    lastFetchedAt?: number | null;
    /** Whether the container is running. When false, the panel is grayed out
     *  rather than showing a skeleton loader (no health checks are coming). */
    active?: boolean;
    /** How many injection-backed health checks to expect (registry-derived,
     *  passed from the server) so the skeleton renders one row per real check
     *  before the first snapshot arrives. */
    injectionChecks?: number;
  } = $props();

  // One row per check: a pass/fail flag plus a uniform value word — "OK" when
  // passing, "—" otherwise (the tick/cross icon already conveys pass vs fail).
  const checks = $derived.by((): { label: string; ok: boolean; value: string }[] => {
    if (!health) return [];
    const v = (ok: boolean) => ({ ok, value: ok ? 'OK' : '—' });
    return [
      { label: FIXED_CHECKS[0], ...v(health.containerRunning) },
      { label: FIXED_CHECKS[1], ...v(health.codeServerAccessible) },
      // One row per injection that reports health (e.g. Claude Code, GitHub CLI, Claude hooks).
      ...health.injections.map((i) => ({ label: i.label, ...v(i.ok) })),
    ];
  });

  // Total health rows: the two fixed checks plus one per injection that reports
  // health. Once a snapshot lands we know the exact count; before then we fall
  // back to the registry-derived expected count so the skeleton matches.
  function getNumberOfChecks(): number {
    return health ? checks.length : FIXED_CHECKS.length + injectionChecks;
  }

  // Tick a local clock so the "updated Ns ago" readout counts up between polls.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const agoLabel = $derived.by(() => {
    if (!active && !health) return 'Container not running';
    if (!lastFetchedAt) return 'Waiting for first check…';
    const secs = Math.max(0, Math.round((now - lastFetchedAt) / 1000));
    return `Updated ${secs}s ago`;
  });
</script>

<div class="healthwrap panel" class:dim={!active && !health}>
  <div class="panel-bar">Health</div>
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
    {:else if active}
      {#each Array(getNumberOfChecks()) as _, i (i)}
        <div class="hrow">
          <span class="box idle"></span>
          <Skeleton width="120px" />
          <Skeleton variant="pill" />
        </div>
      {/each}
    {:else}
      {#each FIXED_CHECKS as label (label)}
        <div class="hrow">
          <span class="box idle"></span>
          <span class="hlabel">{label}</span>
          <span class="hvalue">—</span>
        </div>
      {/each}
    {/if}
  </div>
  <div class="hfoot">{agoLabel}</div>
</div>

<style>
  .healthwrap {
    overflow: hidden;
  }
  /* Container isn't running yet: gray the panel out instead of loading it. */
  .healthwrap.dim {
    opacity: 0.5;
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
</style>
