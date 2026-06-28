<script lang="ts">
  import { pickAvatar, decode, type AvatarArt } from '../avatars/index.ts';

  // `id` selects the artwork (deterministic, stable per instance); `name` is for
  // accessibility. `size` is the tile's pixel footprint on screen. `art` lets a
  // caller (e.g. the dev gallery) render a specific sprite instead of picking.
  let {
    id = '',
    name,
    size = 48,
    art,
  }: { id?: string; name: string; size?: number; art?: AvatarArt } = $props();

  // 256 intensities (0 off / 1 dim / 2 on), row-major, for the chosen 16×16 art.
  const cells = $derived(decode(art ?? pickAvatar(id)));
</script>

<span
  class="avatar"
  role="img"
  aria-label={name}
  title={name}
  style="width:{size}px;height:{size}px"
>
  {#each cells as cell, i (i)}
    <span class="px" class:on={cell === 2} class:dim={cell === 1}></span>
  {/each}
</span>

<style>
  /* A 16×16 dot-matrix panel: each pixel is its own element, with a hairline gap
     so the panel reads like a real LED/LCD grid. Monochrome LCD styling — lit
     dots are ink, unlit dots are a faint tint of the panel. */
  .avatar {
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    grid-template-rows: repeat(16, 1fr);
    gap: 0.5px;
    flex: none;
    box-sizing: border-box;
    padding: 2px;
    border: 1px solid var(--ink);
    background: var(--bg);
  }
  .px {
    background: var(--rule-soft); /* unlit LED — faint */
    border-radius: 0.5px;
  }
  .px.dim {
    background: var(--ink-soft);
  }
  .px.on {
    background: var(--ink);
  }
</style>
