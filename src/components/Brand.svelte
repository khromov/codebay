<script lang="ts">
  import { Package } from '@lucide/svelte';
</script>

<a class="brand" href="/"><span class="logo"><Package size={22} /></span><span>Devcontainers Manager</span></a>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 11px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 22px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: inherit;
    text-decoration: none;
  }
  .logo {
    display: inline-flex;
    align-items: center;
  }
</style>
