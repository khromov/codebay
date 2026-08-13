<script lang="ts">
	import type { Instance } from '../types.ts';

	let { status }: { status: Instance['status'] } = $props();

	const label: Record<Instance['status'], string> = {
		creating: 'Booting…',
		running: 'Running',
		stopped: 'Stopped',
		error: 'Error'
	};
</script>

<span class="status {status}">{label[status]}</span>

<style>
	/* Error is the one true alarm state, so it alone gets hue; the rest read via fill. */
	.status {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		padding: 3px 7px;
		border: 1px solid var(--edge);
		white-space: nowrap;
	}
	.status.running {
		background: var(--slab);
		color: var(--slab-ink);
	}
	.status.stopped {
		background: transparent;
		color: var(--ink-soft);
		border-color: var(--ink-faint);
	}
	.status.creating {
		background: var(--slab);
		color: var(--slab-ink);
		animation: lcd-blink 1.1s steps(1) infinite;
	}
	.status.error {
		background: var(--danger);
		color: var(--bg);
		border-color: var(--danger);
		font-weight: 700;
	}
	@keyframes lcd-blink {
		50% {
			background: transparent;
			color: var(--ink);
		}
	}
</style>
