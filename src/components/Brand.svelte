<script lang="ts">
  import { Package } from '@lucide/svelte';
</script>

<div class="brand"><span class="logo"><Package size={22} /></span><span>Devcontainers Manager</span></div>

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
  }
  .logo {
    display: inline-flex;
    align-items: center;
  }
</style>
