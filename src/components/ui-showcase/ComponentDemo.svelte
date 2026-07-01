<script lang="ts">
  import type { Snippet } from 'svelte';

  // A titled card with a live preview on top and an expandable props panel
  // beneath. `controls` is optional — propless components (Brand, SettingsCog)
  // just show a note instead.
  let {
    title,
    note,
    children,
    controls,
  }: {
    title: string;
    note?: string;
    children: Snippet;
    controls?: Snippet;
  } = $props();
</script>

<section class="demo panel">
  <h2>{title}</h2>
  <div class="preview">
    {@render children()}
  </div>
  {#if controls}
    <details class="controls">
      <summary>Props</summary>
      <div class="fields">
        {@render controls()}
      </div>
    </details>
  {:else}
    <p class="note">{note ?? 'No props.'}</p>
  {/if}
</section>

<style>
  .demo {
    background: var(--bg-card);
  }
  h2 {
    margin: 0;
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule-soft);
    font-family: var(--font-display);
    font-size: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    min-height: 96px;
    padding: 24px;
    /* Faint pixel grid so light components read against the panel. */
    background-image: radial-gradient(var(--rule-soft) 0.5px, transparent 0.5px);
    background-size: 8px 8px;
  }
  .controls {
    border-top: 1px solid var(--rule-soft);
  }
  summary {
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    cursor: pointer;
    user-select: none;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 14px 16px;
  }
  .note {
    margin: 0;
    padding: 10px 14px 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-faint);
  }
</style>
