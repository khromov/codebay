<script lang="ts">
  import Link from '@lucide/svelte/icons/link';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import toast from 'svelte-french-toast';
  import type { AuthProvider } from '../types.ts';

  let { auth }: { auth: AuthProvider[] } = $props();

  let credOpen = $state(false);

  // Aggregate auth status: green when every provider is authorized, red when none
  // are, amber only in the mixed state (impossible until a second provider exists).
  const authedCount = $derived(auth.filter((a) => a.available).length);
  const credState = $derived(
    authedCount === auth.length ? 'ok' : authedCount === 0 ? 'error' : 'warn',
  );
  const credIcon = { ok: Link, warn: TriangleAlert, error: X } as const;
  const CredIcon = $derived(credIcon[credState]);

  function explainProvider(provider: AuthProvider) {
    if (provider.available) {
      toast.success(`${provider.label} credentials come from ${provider.source}.`);
    } else {
      const hint = provider.hint ? ` — ${provider.hint}` : '';
      toast.error(`No ${provider.label} credentials found${hint}.`);
    }
  }

  // Close the credentials dropdown on an outside click or Escape.
  $effect(() => {
    if (!credOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('.cred-menu')) credOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') credOpen = false;
    };
    // Defer registration so the click that opened the menu doesn't immediately close it.
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="cred-menu">
  <button
    class="cred {credState}"
    onclick={() => (credOpen = !credOpen)}
    aria-expanded={credOpen}
    aria-haspopup="menu"
    aria-label="Credentials"
    title="Credentials"
  >
    <CredIcon size={16} />
  </button>
  {#if credOpen}
    <div class="cred-dropdown" role="menu">
      {#each auth as provider (provider.id)}
        <button
          type="button"
          class="cred-row"
          role="menuitem"
          onclick={() => explainProvider(provider)}
          title={provider.available
            ? `Credentials from ${provider.source}, copied into each new instance.`
            : `No credentials found on this computer${provider.hint ? ` — ${provider.hint}` : ''}.`}
        >
          <span class="dot {provider.available ? 'on' : 'off'}"></span>
          <span class="cred-label">{provider.label}</span>
          <span class="cred-state">{provider.available ? 'Authorized' : 'Not found'}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cred-menu {
    position: relative;
    display: inline-flex;
  }
  .cred {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    font-size: 14px;
    line-height: 1;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--bg);
    cursor: pointer;
  }
  .cred:hover {
    background: var(--bg);
    color: var(--ink);
  }
  /* Auth states: ok = muted green, warn = tasteful yellow, error = outline-only. */
  .cred.ok {
    background: var(--ok-bg);
    border-color: var(--ok-line);
    color: var(--ok-ink);
  }
  .cred.ok:hover {
    background: var(--ok-ink);
    border-color: var(--ok-ink);
    color: var(--ok-bg);
  }
  .cred.warn {
    background: var(--warn-bg);
    border-color: var(--warn-line);
    color: var(--warn-ink);
  }
  .cred.warn:hover {
    background: var(--warn-ink);
    border-color: var(--warn-ink);
    color: var(--warn-bg);
  }
  .cred.error {
    background: var(--bg);
    color: var(--ink);
  }
  .cred-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    min-width: 220px;
    padding: 6px;
    background: var(--bg-card);
    border: 1px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
  }
  .cred-row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 7px 9px;
    border: 0;
    background: transparent;
    color: var(--ink);
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .cred-row:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .cred-row:hover .cred-state {
    color: var(--bg);
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border: 1px solid currentColor;
  }
  .dot.on {
    background: currentColor;
  }
  .dot.off {
    background: transparent;
  }
  .cred-state {
    margin-left: auto;
    color: var(--ink-soft);
  }
</style>
