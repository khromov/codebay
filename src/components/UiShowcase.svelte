<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import toast, { Toaster } from 'svelte-french-toast';
  import { avatars } from '../avatars/index.ts';
  import type { AuthProvider, InstanceHealth, Preflight } from '../types.ts';

  let { preflight }: { preflight: Preflight } = $props();
  import Avatar from './Avatar.svelte';
  import Button from './Button.svelte';
  import Brand from './Brand.svelte';
  import CredMenu from './CredMenu.svelte';
  import SettingsCog from './SettingsCog.svelte';
  import TopBar from './TopBar.svelte';
  import IdeLoader from './IdeLoader.svelte';
  import HealthBox from './HealthBox.svelte';
  import ComponentDemo from './ui-showcase/ComponentDemo.svelte';

  // --- Avatar controls ---
  let avatarScale = $state(8);
  let avatarName = $state('demo-instance');
  let avatarId = $state('alpha');
  // '' means "pick by id"; otherwise the value is an avatar name from the catalog.
  let avatarArtName = $state('');
  const avatarArt = $derived(avatars.find((a) => a.name === avatarArtName));

  // --- Button controls ---
  let btnVariant = $state<'default' | 'primary' | 'danger'>('primary');
  let btnSize = $state<'sm' | 'md' | 'lg'>('md');
  let btnDisabled = $state(false);
  let btnIcon = $state(true);
  let btnLabel = $state('New Instance');

  // --- IdeLoader controls ---
  let loaderSpeed = $state(1);

  // --- CredMenu controls ---
  // Seed from the server's real preflight so the menu mirrors `/`; the presets
  // and checkboxes below then let you exercise the other aggregate states.
  // svelte-ignore state_referenced_locally
  let providers = $state<AuthProvider[]>($state.snapshot(preflight.auth));
  function presetCred(state: 'ok' | 'warn' | 'error') {
    providers.forEach((p, i) => {
      // warn = mixed: first provider on, the rest off.
      p.available = state === 'ok' || (state === 'warn' && i === 0);
    });
  }

  // --- HealthBox controls ---
  let healthLoading = $state(false);
  let healthChecks = $state({
    containerRunning: true,
    codeServerAccessible: true,
    hooksPresent: true,
    credsPresent: false,
  });
  // Stamp a fetch time so the "updated Ns ago" readout ticks; "refresh" resets it.
  let healthFetchedAt = $state(Date.now());
  const demoHealth = $derived<InstanceHealth | null>(
    healthLoading ? null : { ...healthChecks, openPorts: [], checkedAt: healthFetchedAt },
  );
</script>

<Toaster />

<TopBar
  auth={providers}
  canDelete={true}
  ready={true}
  creating={false}
  onNew={() => toast('New instance (demo)')}
  onDeleteAll={() => toast('Delete all (demo)')}
/>

<main class="showcase">
  <header>
    <h1>UI</h1>
    <p>Component showcase · dev preview · tweak each component’s props below</p>
    <a class="gallery-link" href="/debug/avatars">→ Avatar sprite gallery</a>
  </header>

  <div class="grid">
    <ComponentDemo title="Avatar">
      <Avatar
        id={avatarId}
        name={avatarName}
        scale={avatarScale}
        art={avatarArt}
      />
      {#snippet controls()}
        <label>
          <span>scale ({avatarScale})</span>
          <input type="range" min="1" max="12" bind:value={avatarScale} />
        </label>
        <label>
          <span>name</span>
          <input type="text" bind:value={avatarName} />
        </label>
        <label>
          <span>id</span>
          <input type="text" bind:value={avatarId} />
        </label>
        <label>
          <span>art</span>
          <select bind:value={avatarArtName}>
            <option value="">(pick by id)</option>
            {#each avatars as art (art.name)}
              <option value={art.name}>{art.name}</option>
            {/each}
          </select>
        </label>
      {/snippet}
    </ComponentDemo>

    <ComponentDemo title="Button">
      <Button
        variant={btnVariant}
        size={btnSize}
        disabled={btnDisabled}
        icon={btnIcon ? Plus : undefined}
      >
        {btnLabel}
      </Button>
      {#snippet controls()}
        <label>
          <span>variant</span>
          <select bind:value={btnVariant}>
            <option value="default">default</option>
            <option value="primary">primary</option>
            <option value="danger">danger</option>
          </select>
        </label>
        <label>
          <span>size</span>
          <select bind:value={btnSize}>
            <option value="sm">sm</option>
            <option value="md">md</option>
            <option value="lg">lg</option>
          </select>
        </label>
        <label>
          <span>label</span>
          <input type="text" bind:value={btnLabel} />
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={btnIcon} />
          <span>icon (Plus)</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={btnDisabled} />
          <span>disabled</span>
        </label>
      {/snippet}
    </ComponentDemo>

    <ComponentDemo title="CredMenu">
      <CredMenu auth={providers} />
      {#snippet controls()}
        <div class="presets">
          <button type="button" onclick={() => presetCred('ok')}>ok</button>
          <button type="button" onclick={() => presetCred('warn')}>warn</button>
          <button type="button" onclick={() => presetCred('error')}>error</button>
        </div>
        {#each providers as provider (provider.id)}
          <label class="inline">
            <input type="checkbox" bind:checked={provider.available} />
            <span>{provider.label} available</span>
          </label>
        {/each}
      {/snippet}
    </ComponentDemo>

    <ComponentDemo title="IdeLoader">
      <div class="loader-stage">
        <IdeLoader speed={loaderSpeed} />
      </div>
      {#snippet controls()}
        <label>
          <span>speed ({loaderSpeed.toFixed(2)}×)</span>
          <input type="range" min="0.25" max="3" step="0.25" bind:value={loaderSpeed} />
        </label>
      {/snippet}
    </ComponentDemo>

    <ComponentDemo title="HealthBox">
      <HealthBox health={demoHealth} lastFetchedAt={healthLoading ? null : healthFetchedAt} />
      {#snippet controls()}
        <div class="presets">
          <button type="button" onclick={() => (healthFetchedAt = Date.now())}>refresh now</button>
        </div>
        <label class="inline">
          <input type="checkbox" bind:checked={healthLoading} />
          <span>loading (skeleton)</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={healthChecks.containerRunning} />
          <span>container running</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={healthChecks.codeServerAccessible} />
          <span>code-server reachable</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={healthChecks.hooksPresent} />
          <span>hooks present</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={healthChecks.credsPresent} />
          <span>credentials present</span>
        </label>
      {/snippet}
    </ComponentDemo>

    <ComponentDemo title="Brand" note="No props — static branding.">
      <Brand />
    </ComponentDemo>

    <ComponentDemo title="SettingsCog" note="No props — links to /settings.">
      <SettingsCog />
    </ComponentDemo>
  </div>
</main>

<style>
  .showcase {
    min-height: 100vh;
    max-width: 740px;
    margin: 0 auto;
    padding: 32px;
    background: var(--bg);
    color: var(--ink);
  }
  header {
    margin-bottom: 28px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 24px;
    letter-spacing: 0.04em;
  }
  header p {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-soft);
  }
  .gallery-link {
    display: inline-block;
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px solid var(--ink);
  }
  .gallery-link:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* Shared control styling — minimal monochrome to match the LCD look.
     `.fields` lives in the child ComponentDemo, so target it globally. */
  .showcase :global(.fields label) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
  }
  .showcase :global(.fields label.inline) {
    flex-direction: row;
    align-items: center;
    gap: 7px;
  }
  .showcase :global(.fields input[type='text']),
  .showcase :global(.fields select) {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--ink);
    padding: 5px 7px;
  }
  .showcase :global(.fields input[type='range']),
  .showcase :global(.fields input[type='checkbox']) {
    accent-color: var(--ink);
  }
  /* IdeLoader is an inset:0 overlay, so give it a sized, positioned stage. */
  .loader-stage {
    position: relative;
    width: 100%;
    height: 180px;
    border: 1px solid var(--rule-soft);
    overflow: hidden;
  }
  .presets {
    display: flex;
    gap: 6px;
  }
  .presets button {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink);
    background: var(--bg-card);
    border: 1px solid var(--ink);
    padding: 5px 0;
    cursor: pointer;
  }
  .presets button:hover {
    background: var(--ink);
    color: var(--bg);
  }
</style>
