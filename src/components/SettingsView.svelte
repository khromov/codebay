<script lang="ts">
  import Container from '@lucide/svelte/icons/container';
  import House from '@lucide/svelte/icons/house';
  import Power from '@lucide/svelte/icons/power';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import { soundEnabled, setSoundEnabled } from '../settings.ts';
  import { playChime, unlockAudio } from '../sound.ts';
  import Button from './Button.svelte';

  let {
    defaultImage,
    builtinImage,
    dockerArch,
  }: { defaultImage: string; builtinImage: string; dockerArch: string | null } = $props();

  // Initialize from localStorage on the client; defaults to on during SSR.
  // svelte-ignore state_referenced_locally
  let sound = $state(soundEnabled());

  let shuttingDown = $state(false);

  // svelte-ignore state_referenced_locally
  let image = $state(defaultImage);
  let savingImage = $state(false);
  let imageError = $state<string | null>(null);
  let imageSaved = $state(false);

  async function persistImage(value: string) {
    if (!value) {
      imageError = 'Enter an image reference';
      return;
    }
    imageError = null;
    imageSaved = false;
    savingImage = true;
    try {
      const res = await fetch('/api/settings/default-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message: string } }
          | null;
        throw new Error(data?.error?.message ?? 'Request failed');
      }
      image = value;
      imageSaved = true;
    } catch (err) {
      imageError = (err as Error).message;
    } finally {
      savingImage = false;
    }
  }

  function saveImage(e: Event) {
    e.preventDefault();
    void persistImage(image.trim());
  }

  // Restore the built-in default image and persist it.
  function resetImage() {
    image = builtinImage;
    void persistImage(builtinImage);
  }

  function toggleSound(on: boolean) {
    sound = on;
    setSoundEnabled(on);
    // A toggle is a user gesture — unlock audio and preview when enabling.
    unlockAudio();
    if (on) playChime('done');
  }

  async function deleteAndShutdown() {
    if (
      !confirm(
        'Delete the database, remove all instances and their containers, and shut down the server? This cannot be undone.',
      )
    )
      return;
    shuttingDown = true;
    try {
      await fetch('/api/shutdown', { method: 'POST' });
    } catch {
      // The server exits mid-response, so a network error here is expected.
    }
  }
</script>

<div class="page">
  <header class="bar">
    <a class="home" href="/" title="All instances" aria-label="All instances"><House size={18} /></a>
    <span class="title">Settings</span>
  </header>

  <main class="content">
    <section class="card">
      <form class="row image-row" onsubmit={saveImage}>
        <div class="label">
          <Container size={18} />
          <div class="text">
            <div class="name">
              Default container image
              {#if dockerArch}
                <span class="arch" title="Docker daemon architecture">{dockerArch}</span>
              {/if}
            </div>
            <div class="desc">
              Used only when a project folder ships no devcontainer.json. Takes effect for
              instances created from now on.
            </div>
          </div>
        </div>
        <div class="image-controls">
          <input
            type="text"
            class="image-input"
            bind:value={image}
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            placeholder="mcr.microsoft.com/devcontainers/base:ubuntu"
          />
          <Button type="submit" disabled={savingImage}>Save</Button>
          <Button
            type="button"
            icon={RotateCcw}
            disabled={savingImage}
            onclick={resetImage}
            title="Reset to default ({builtinImage})"
            aria-label="Reset to default image"
          />
        </div>
        <div class="desc tip">
          {#if dockerArch}
            Your Docker daemon runs on <strong>{dockerArch}</strong> — pick an image that publishes
            an <strong>{dockerArch}</strong> manifest, or the pull will fail.
          {:else}
            Pick an image whose manifest covers your Docker daemon's architecture, or the pull will
            fail.
          {/if}
        </div>
        {#if imageError}
          <div class="msg error">{imageError}</div>
        {:else if imageSaved}
          <div class="msg ok">Saved.</div>
        {/if}
      </form>
    </section>

    <section class="card">
      <div class="row">
        <div class="label">
          <Volume2 size={18} />
          <div class="text">
            <div class="name">Attention sound</div>
            <div class="desc">
              Play a chime when an instance finishes a task or needs your input.
            </div>
          </div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={sound}
            onchange={(e) => toggleSound(e.currentTarget.checked)}
          />
          <span class="track"><span class="thumb"></span></span>
        </label>
      </div>
    </section>

    <section class="card danger-card">
      <div class="row">
        <div class="label">
          <Power size={18} />
          <div class="text">
            <div class="name">Delete database, containers, and shut down</div>
            <div class="desc">
              Stop and remove every instance and its container, delete all copied
              workspaces and the database, then shut down the server. This cannot be undone.
            </div>
          </div>
        </div>
        {#if shuttingDown}
          <span class="shutting">Server is shutting down — you can close this tab.</span>
        {:else}
          <Button variant="danger" onclick={deleteAndShutdown}>Delete &amp; shut down</Button>
        {/if}
      </div>
    </section>
  </main>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .bar {
    display: flex;
    align-items: center;
    height: 44px;
    border-bottom: 1px solid var(--rule);
    background: var(--bg-card);
  }
  .home {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    flex: none;
    color: var(--ink);
    border-right: 1px solid var(--rule);
    height: 100%;
  }
  .home:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .title {
    padding: 0 14px;
    font-family: var(--font-mono);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
  }
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 32px 20px;
  }
  .card {
    width: 100%;
    max-width: 560px;
    background: var(--bg-card);
    border: 1px solid var(--rule);
    height: max-content;
  }
  .danger-card {
    border-color: var(--danger);
  }
  /* Keep the action button on one line; in the flex row it would otherwise shrink and wrap. */
  .danger-card :global(.btn) {
    flex: none;
    white-space: nowrap;
  }
  .shutting {
    flex: none;
    max-width: 200px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--danger);
    line-height: 1.4;
    text-align: right;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 18px;
  }
  .label {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    color: var(--ink);
    min-width: 0;
  }
  .text {
    min-width: 0;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .arch {
    margin-left: 8px;
    padding: 2px 6px;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
    border-radius: 3px;
    vertical-align: middle;
  }
  .tip {
    width: 100%;
    margin-top: 4px;
    padding: 8px 10px;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--info) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--info) 35%, transparent);
    border-radius: 4px;
  }
  .desc {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-faint);
    line-height: 1.4;
  }
  /* Default-image editor: input + Save, stacked under the label on narrow widths. */
  .image-row {
    flex-wrap: wrap;
  }
  .image-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 220px;
    justify-content: flex-end;
  }
  .image-input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--rule);
  }
  .image-input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .image-controls :global(.btn) {
    flex: none;
  }
  .msg {
    width: 100%;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.4;
  }
  .msg.error {
    color: var(--danger);
  }
  .msg.ok {
    color: var(--ink-soft);
  }
  /* Switch */
  .switch {
    position: relative;
    flex: none;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .track {
    display: block;
    width: 44px;
    height: 24px;
    border: 1px solid var(--rule);
    background: var(--bg);
    border-radius: 999px;
    transition: background 0.15s ease;
  }
  .thumb {
    display: block;
    width: 18px;
    height: 18px;
    margin: 2px;
    background: var(--ink-faint);
    border-radius: 999px;
    transition:
      transform 0.15s ease,
      background 0.15s ease;
  }
  .switch input:checked + .track {
    background: rgba(34, 197, 94, 0.32);
  }
  .switch input:checked + .track .thumb {
    transform: translateX(20px);
    background: var(--ink);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
