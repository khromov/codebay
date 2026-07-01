<script lang="ts">
  import { type Instance } from '../types.ts';
  import Avatar from './Avatar.svelte';
  import BranchBox from './BranchBox.svelte';
  import PortsBox from './PortsBox.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import Button from './Button.svelte';

  let {
    instance,
    editing,
    editingName = $bindable(),
    onact,
    onstartrename,
    oncommitrename,
    oncancelrename,
  }: {
    instance: Instance;
    editing: boolean;
    editingName: string;
    onact: (action: 'start' | 'stop' | 'delete') => void;
    onstartrename: () => void;
    oncommitrename: () => void;
    oncancelrename: () => void;
  } = $props();
</script>

<li class="card panel">
  <div class="card-head">
    <Avatar id={instance.id} name={instance.name} interactive />
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-edit"
        bind:value={editingName}
        autofocus
        onblur={oncommitrename}
        onkeydown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === 'Escape') oncancelrename();
        }}
      />
    {:else}
      <button
        class="name"
        title="Click to rename"
        onclick={onstartrename}
      >{instance.name}</button>
    {/if}
    {#if instance.attention}
      <span
        class="attn"
        class:attn-done={instance.attention === 'done'}
        class:attn-waiting={instance.attention === 'waiting'}
        title={instance.attention === 'waiting'
          ? 'Claude is waiting for input'
          : 'Claude finished'}
        aria-label={instance.attention === 'waiting'
          ? 'Claude is waiting for input'
          : 'Claude finished'}
      ></span>
    {/if}
    <StatusBadge status={instance.status} />
  </div>
  <div class="path" title={instance.source_path}>{instance.source_path}</div>
  {#if instance.status === 'running'}
    <PortsBox ports={instance.forwarded_ports} />
  {/if}
  {#if instance.git_branch}
    <BranchBox branch={instance.git_branch} />
  {/if}
  {#if instance.status === 'error' && instance.error}
    <div class="card-error">{instance.error}</div>
  {/if}
  <div class="actions">
    {#if instance.status === 'running'}
      <Button variant="primary" size="sm" href={`/ide/${instance.id}`}>Open IDE</Button>
      <Button size="sm" onclick={() => onact('stop')}>Stop</Button>
    {:else if instance.status === 'stopped' || (instance.status === 'error' && instance.container_id)}
      <Button size="sm" onclick={() => onact('start')}>Start</Button>
    {:else if instance.status === 'creating'}
      <Button size="sm" href={`/instances/${instance.id}`}>View logs</Button>
    {/if}
    <Button size="sm" ghost href={`/instances/${instance.id}`}>Details</Button>
    <Button variant="danger" size="sm" onclick={() => onact('delete')}>Delete</Button>
  </div>
</li>

<style>
  .card {
    background: var(--bg-card);
    padding: 16px 16px 14px;
    transition: transform 0.08s steps(2), box-shadow 0.08s steps(2);
  }
  .card:hover {
    transform: translate(-1px, -1px);
    box-shadow: 6px 6px 0 var(--ink);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 11px;
  }
  /* Attention pulse raised by the in-container Claude hook, mirroring the IDE tabs:
     'done' pulses green, 'waiting' pulses amber. */
  .attn {
    flex: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--ink);
  }
  .attn.attn-done {
    background: var(--attn-done);
    animation: card-attn-pulse 1.4s ease-in-out infinite;
  }
  .attn.attn-waiting {
    background: var(--attn-waiting);
    animation: card-attn-pulse 1.4s ease-in-out infinite;
  }
  @keyframes card-attn-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 transparent;
      filter: brightness(0.85);
    }
    50% {
      box-shadow: 0 0 7px 2px color-mix(in srgb, currentColor 60%, transparent);
      filter: brightness(1.15);
    }
  }
  .attn.attn-done {
    color: var(--attn-done);
  }
  .attn.attn-waiting {
    color: var(--attn-waiting);
  }
  @media (prefers-reduced-motion: reduce) {
    .attn {
      animation: none;
      filter: none;
    }
  }
  .name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Reset button chrome so it reads as plain text until hovered. */
    margin: 0;
    padding: 2px 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .name:hover {
    border-color: var(--ink-faint);
  }
  .name-edit {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 15px;
    margin: 0;
    padding: 2px 4px;
    border: 1px solid var(--ink);
    background: var(--bg);
    color: var(--ink);
    outline: none;
  }
  .path {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-error {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--ink);
    padding: 8px 10px;
    max-height: 80px;
    overflow: auto;
  }
  .actions {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
