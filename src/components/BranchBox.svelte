<script lang="ts">
	import GitBranch from '@lucide/svelte/icons/git-branch';

	// Compact badge: a GitBranch icon + the branch currently checked out in the container.
	let { branch }: { branch: string } = $props();
</script>

<div class="branch" title="Branch checked out in the container">
	<GitBranch size={12} /><span>{branch}</span>
</div>

<style>
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
</style>
