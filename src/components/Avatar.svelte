<script lang="ts">
  import { pickAvatar, decode, type AvatarArt } from '../avatars/index.ts';

  // `id` selects the artwork (deterministic, stable per instance); `name` is for
  // accessibility. `art` lets a caller (e.g. the dev gallery) render a specific
  // sprite instead of picking. `scale` is device-pixels per LED cell — the panel
  // is always rendered at an integer multiple (8 × scale px) so every pixel
  // lands on a crisp boundary. e.g. scale 6 → 48×48.
  let {
    id = '',
    name,
    scale = 6,
    art,
  }: { id?: string; name: string; scale?: number; art?: AvatarArt } = $props();

  // Clamp to a whole number ≥ 1 — fractional scales would blur the grid.
  const s = $derived(Math.max(1, Math.round(scale)));
  // A thin 0.5px gutter reads as a hairline LED gap (a crisp 1 device-pixel on
  // 2× displays). At 1× the cells are too small to spare any, so dots butt up.
  const gap = $derived(s >= 2 ? 0.5 : 0);

  // 64 intensities (0 off / 1 dim / 2 on), row-major, for the chosen 8×8 art.
  const cells = $derived(decode(art ?? pickAvatar(id)));
</script>

<span
  class="avatar"
  role="img"
  aria-label={name}
  title={name}
  style="width:{8 * s}px;height:{8 * s}px;--gap:{gap}px"
>
  {#each cells as cell, i (i)}
    <span class="px" class:on={cell === 2} class:dim={cell === 1}></span>
  {/each}
</span>

<style>
  /* An 8×8 dot-matrix panel: each pixel is its own element. The panel is sized
     to an exact 8×scale so each cell is `scale` device-pixels — crisp, no
     sub-pixel blur. Monochrome LCD styling — lit dots are ink, unlit dots a
     faint tint. The LED gap is a per-cell gutter (see --gap) so it never throws
     off the integer cell size. */
  .avatar {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
    flex: none;
    border: 1px solid var(--ink);
    background: var(--bg);
  }
  .px {
    box-sizing: border-box;
    padding: 0 var(--gap) var(--gap) 0;
    background-clip: content-box;
    background-color: var(--rule-soft); /* unlit LED — faint */
  }
  .px.dim {
    background-color: var(--ink-soft);
  }
  .px.on {
    background-color: var(--ink);
  }
</style>
