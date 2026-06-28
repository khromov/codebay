<script lang="ts">
  let { name }: { name: string } = $props();

  // One- or two-letter monogram for the square LCD avatar tile, derived from
  // the instance name (no server-side avatar needed for the monochrome theme).
  function initials(name: string): string {
    const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const [first, second] = parts;
    if (!first) return '··';
    if (!second) return first.slice(0, 2).toUpperCase();
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
</script>

<span class="avatar">{initials(name)}</span>

<style>
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border: 1px solid var(--ink);
    background: var(--bg);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 17px;
    letter-spacing: 0.02em;
    color: var(--ink);
  }
</style>
