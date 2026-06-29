<script lang="ts">
  import { pickAvatar, decode, type AvatarArt } from '../avatars/index.ts';

  // `id` selects the artwork (deterministic, stable per instance); `name` is for
  // accessibility. `art` lets a caller (e.g. the dev gallery) render a specific
  // sprite instead of picking. `scale` is device-pixels per LED cell — the panel
  // is always rendered at an integer multiple (10 × scale px) so every pixel
  // lands on a crisp boundary. e.g. scale 6 → 60×60.
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

  // 64 on/off cells (0 off / 1 on), row-major, for the chosen 8×8 art.
  const cells = $derived(decode(art ?? pickAvatar(id)));
  // Frame the art in a 10×10 panel: the outer ring is unlit LED cells (a bezel
  // of real dots, not blank padding), the inner 8×8 holds the art. Row-major.
  const grid = $derived(
    Array.from({ length: 100 }, (_, i) => {
      const r = Math.floor(i / 10);
      const c = i % 10;
      const inner = r >= 1 && r <= 8 && c >= 1 && c <= 8;
      return inner ? cells[(r - 1) * 8 + (c - 1)] : 0;
    }),
  );
</script>

<span
  class="avatar"
  role="img"
  aria-label={name}
  title={name}
  style="width:{10 * s}px;height:{10 * s}px;--gap:{gap}px"
>
  {#each grid as cell, i (i)}
    <span class="px" class:on={cell === 1}></span>
  {/each}
</span>

<style>
  /* A 10×10 dot-matrix panel: each pixel is its own element. The outer ring is
     unlit LED cells framing the 8×8 art. The panel is sized to an exact
     10×scale so each cell is `scale` device-pixels — crisp, no sub-pixel blur.
     Monochrome LCD styling — lit dots are ink, unlit dots a faint tint. The LED
     gap is a per-cell gutter (see --gap) so it never throws off the integer
     cell size. */
  .avatar {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    grid-template-rows: repeat(10, 1fr);
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
  .px.on {
    background-color: var(--ink);
  }
</style>
