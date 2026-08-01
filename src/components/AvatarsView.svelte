<script lang="ts">
	import { Toaster } from 'svelte-french-toast';
	import AppBar from './AppBar.svelte';
	import Avatar from './Avatar.svelte';
	import AvatarEditor from './AvatarEditor.svelte';
	import Bot from '@lucide/svelte/icons/bot';
	import { avatars } from '../avatars/index.ts';

	let { namePlaceholder }: { namePlaceholder: string } = $props();
</script>

<div class="page">
	<AppBar>
		<span class="title">Avatars</span>
	</AppBar>

	<main class="content">
		<AvatarEditor {namePlaceholder} />

		<section class="catalog">
			<header>
				<h2>The set</h2>
				<p>{avatars.length} hand-crafted 8×8 sprites</p>
			</header>
			<ul>
				{#each avatars as art (art.name)}
					<li>
						<Avatar {art} name={art.name} scale={8} interactive />
						<span class="label">
							{#if art.robot}
								<span class="robot-mark" title="AI-generated"><Bot size={11} /></span>
							{/if}
							{art.name}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	</main>
</div>

<!-- This page renders outside AppShell, which hosts the app-wide Toaster. -->
<Toaster
	toastOptions={{
		style:
			'border:1px solid var(--ink); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--ink); font-family:var(--font-mono); font-size:13px;'
	}}
/>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	.title {
		display: inline-flex;
		align-items: center;
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
		gap: 24px;
		padding: 32px 20px;
	}
	.content > :global(*) {
		width: 100%;
		max-width: 720px;
	}
	.catalog {
		background: var(--bg-card);
		border: 1px solid var(--rule);
		padding: 18px;
	}
	.catalog header {
		margin-bottom: 20px;
	}
	.catalog h2 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.catalog header p {
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
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
	}
	.robot-mark {
		display: inline-flex;
		color: var(--ink-faint);
	}
</style>
