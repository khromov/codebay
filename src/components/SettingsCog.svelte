<script lang="ts">
	import Settings from '@lucide/svelte/icons/settings';
	import { withPopupMarker } from '../lib/popup-nav.ts';
</script>

<a
	class="cog"
	href={withPopupMarker('/settings')}
	target="_blank"
	rel="noopener noreferrer"
	aria-label="Settings"
	title="Settings"><Settings size={16} /></a
>

<style>
	.cog {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--ink);
		background: var(--bg-card);
		color: var(--ink);
	}
	.cog:hover {
		background: var(--ink);
		color: var(--bg);
	}
</style>
