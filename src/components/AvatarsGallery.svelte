<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { avatars } from '../avatars/index.ts';
</script>

<main class="gallery">
	<header>
		<h1>Avatars</h1>
		<p>{avatars.length} hand-crafted 8×8 sprites · dev preview</p>
	</header>
	<ul>
		{#each avatars as art (art.name)}
			<li>
				<Avatar {art} name={art.name} scale={8} interactive />
				<span class="label">{art.name}</span>
			</li>
		{/each}
	</ul>
</main>

<style>
	.gallery {
		min-height: 100vh;
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
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 20px;
	}
	li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.label {
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
</style>
