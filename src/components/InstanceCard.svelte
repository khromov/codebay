<script lang="ts">
  import { type Instance } from '../types.ts';
  import Avatar from './Avatar.svelte';
  import { Cable, GitBranch } from '@lucide/svelte';

  let {
    instance,
    editing,
    editingName = $bindable(),
    statusLabel,
    onact,
    onstartrename,
    oncommitrename,
    oncancelrename,
  }: {
    instance: Instance;
    editing: boolean;
    editingName: string;
    statusLabel: Record<Instance['status'], string>;
    onact: (action: 'start' | 'stop' | 'delete') => void;
    onstartrename: () => void;
    oncommitrename: () => void;
    oncancelrename: () => void;
  } = $props();
</script>

<li class="card">
  <div class="card-head">
    <Avatar id={instance.id} name={instance.name} />
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
    <span class="status {instance.status}">{statusLabel[instance.status]}</span>
  </div>
  <div class="path" title={instance.source_path}>{instance.source_path}</div>
  {#if instance.status === 'running' && instance.forwarded_ports.length}
    <div class="fports" title="Forwarded ports — click to open">
      <Cable size={12} />
      <span class="list">
        {#each instance.forwarded_ports as f (f.container_port)}
          <a
            class="fport"
            class:open={f.open}
            href={`http://localhost:${f.host_port}`}
            target="_blank"
            rel="noopener"
            title={`container :${f.container_port} → http://localhost:${f.host_port} ${f.open ? '(open)' : '(not published yet)'}`}
          >{f.container_port}</a>
        {/each}
      </span>
    </div>
  {/if}
  {#if instance.git_branch}
    <div class="branch" title="Branch checked out in the container">
      <GitBranch size={12} /><span>{instance.git_branch}</span>
    </div>
  {/if}
  {#if instance.status === 'error' && instance.error}
    <div class="card-error">{instance.error}</div>
  {/if}
  <div class="actions">
    {#if instance.status === 'running'}
      <a class="btn open" href={`/ide/${instance.id}`}>Open IDE</a>
      <button class="btn" onclick={() => onact('stop')}>Stop</button>
    {:else if instance.status === 'stopped'}
      <button class="btn" onclick={() => onact('start')}>Start</button>
    {:else if instance.status === 'creating'}
      <a class="btn" href={`/instances/${instance.id}`}>View logs</a>
    {/if}
    <a class="btn ghost" href={`/instances/${instance.id}`}>Details</a>
    <button class="btn danger" onclick={() => onact('delete')}>Delete</button>
  </div>
</li>

<style>
  .card {
    background: var(--bg-card);
    border: 1px solid var(--ink);
    padding: 16px 16px 14px;
    box-shadow: 4px 4px 0 var(--ink);
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
  /* Monochrome theme: status reads via fill/pattern/animation, not hue. */
  .status {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 7px;
    border: 1px solid var(--ink);
    white-space: nowrap;
  }
  .status.running {
    background: var(--ink);
    color: var(--bg);
  }
  .status.stopped {
    background: transparent;
    color: var(--ink-soft);
    border-color: var(--ink-faint);
  }
  .status.creating {
    background: var(--ink);
    color: var(--bg);
    animation: lcd-blink 1.1s steps(1) infinite;
  }
  .status.error {
    background: repeating-linear-gradient(
      45deg,
      var(--ink) 0 3px,
      transparent 3px 6px
    );
    color: var(--ink);
    border-width: 2px;
    font-weight: 700;
  }
  @keyframes lcd-blink {
    50% {
      background: transparent;
      color: var(--ink);
    }
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
  /* Mini badge mirroring .branch: icon + a comma-separated list of forwarded ports. */
  .fports {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    border: 1px solid var(--ink-faint);
    padding: 2px 7px;
  }
  .fports :global(svg) {
    flex: none;
  }
  /* Flex list drops the source whitespace between links, so commas sit flush. */
  .list {
    display: flex;
    flex-wrap: wrap;
    min-width: 0;
  }
  /* Status reads via the leading dot + fill: hollow + dimmed = not yet published,
     filled + full ink = the live container actually exposes this port. */
  .fport {
    color: var(--ink-soft);
    text-decoration: none;
  }
  .fport::before {
    content: '○\00a0';
    color: var(--ink-faint);
  }
  .fport.open {
    color: var(--ink);
  }
  .fport.open::before {
    content: '●\00a0';
    color: var(--ink);
  }
  .fport:hover {
    text-decoration: underline;
  }
  .fport:not(:last-child)::after {
    content: ',';
    color: var(--ink-faint);
    margin-right: 4px;
  }
  .branch {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink);
    border: 1px solid var(--ink-faint);
    padding: 2px 7px;
  }
  .branch :global(svg) {
    flex: none;
  }
  .branch span {
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
  .btn {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 7px 12px;
    border: 1px solid var(--ink);
    background: var(--bg-card);
    color: var(--ink);
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover {
    background: var(--ink);
    color: var(--bg);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn:disabled:hover {
    background: var(--bg-card);
    color: var(--ink);
  }
  .btn.open {
    background: var(--ink);
    color: var(--bg);
  }
  .btn.open:hover {
    background: var(--bg-card);
    color: var(--ink);
  }
  .btn.ghost {
    background: transparent;
    border-style: dashed;
  }
  .btn.ghost:hover {
    background: var(--ink);
    color: var(--bg);
    border-style: solid;
  }
  .btn.danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .btn.danger:hover:not(:disabled) {
    color: var(--danger);
    background-color: var(--danger-soft);
    border-color: transparent;
    /* Slowly marching red "ants" border, drawn as four animated edge gradients. */
    background-image:
      linear-gradient(90deg, var(--danger) 50%, transparent 0),
      linear-gradient(90deg, var(--danger) 50%, transparent 0),
      linear-gradient(0deg, var(--danger) 50%, transparent 0),
      linear-gradient(0deg, var(--danger) 50%, transparent 0);
    background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
    background-size: 14px 2px, 14px 2px, 2px 14px, 2px 14px;
    background-position: 0 0, 0 100%, 0 0, 100% 0;
    animation: marching-ants 2s linear infinite;
  }
  @keyframes marching-ants {
    to {
      background-position: 28px 0, -28px 100%, 0 -28px, 100% 28px;
    }
  }
</style>
