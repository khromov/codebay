<script lang="ts">
  import Cable from '@lucide/svelte/icons/cable';
  import type { PortForward } from '../types.ts';

  // Compact badge: a Cable icon + a comma-separated list of forwarded ports. Each
  // port reads its live state via the leading dot — filled = the container actually
  // publishes it, hollow = configured but not published yet (e.g. pending rebuild).
  let { ports }: { ports: PortForward[] } = $props();
</script>

{#if ports.length}
  <div class="fports" title="Forwarded ports — click to open">
    <Cable size={12} />
    <span class="list">
      {#each ports as f (f.container_port)}
        <a
          class="fport"
          class:open={f.open}
          href={`http://localhost:${f.host_port}`}
          target="_blank"
          rel="noopener"
          title={`container :${f.container_port} → http://localhost:${f.host_port} ${f.open ? '(open)' : '(not published yet)'}`}
        >{f.container_port}</a>
      {/each}
    </span>
  </div>
{/if}

<style>
  .fports {
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
  .fports :global(svg) {
    flex: none;
  }
  /* Flex list drops the source whitespace between links, so commas sit flush. */
  .list {
    display: flex;
    flex-wrap: wrap;
    min-width: 0;
  }
  /* Status reads via the leading dot + fill: hollow + dimmed = not yet published,
     filled + full ink = the live container actually exposes this port. */
  .fport {
    color: var(--ink-soft);
    text-decoration: none;
  }
  .fport::before {
    content: '○\00a0';
    color: var(--ink-faint);
  }
  .fport.open {
    color: var(--ink);
  }
  .fport.open::before {
    content: '●\00a0';
    color: var(--ink);
  }
  .fport:hover {
    text-decoration: underline;
  }
  .fport:not(:last-child)::after {
    content: ',';
    color: var(--ink-faint);
    margin-right: 4px;
  }
</style>
