<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Copy from '@lucide/svelte/icons/copy';
	import Eraser from '@lucide/svelte/icons/eraser';
	import Contrast from '@lucide/svelte/icons/contrast';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import toast from 'svelte-french-toast';
	import { ROWS, COLS, ON, OFF, type AvatarArt } from '../avatars/types.ts';
	import {
		cellsToPixels,
		normalizeName,
		toModuleSource,
		toIssueUrl
	} from '../avatars/serialize.ts';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';

	let { onclose }: { onclose: () => void } = $props();

	// The drawing: 64 row-major on/off cells, same shape `decode()` produces.
	let cells = $state<number[]>(Array(ROWS * COLS).fill(OFF));
	let avatarName = $state('');

	const slug = $derived(normalizeName(avatarName));
	const art = $derived<AvatarArt>({ name: slug || 'my-avatar', pixels: cellsToPixels(cells) });
	// Contributing needs a name and at least one lit pixel — a blank sprite is no sprite.
	const canContribute = $derived(slug.length > 0 && cells.some((c) => c === ON));

	// Drag-to-paint: capture the pointer on the grid and derive the cell from
	// coordinates (same rect math as Avatar's press gag), so one stroke paints
	// every cell it crosses — with the value that flips the first cell pressed.
	let gridEl = $state<HTMLDivElement | null>(null);
	let painting = false;
	let paintValue: number = ON;

	function cellAt(e: PointerEvent): number | null {
		if (!gridEl) return null;
		const rect = gridEl.getBoundingClientRect();
		const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
		const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
		if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
		return r * COLS + c;
	}

	function onpointerdown(e: PointerEvent) {
		const i = cellAt(e);
		if (i == null) return;
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		painting = true;
		paintValue = cells[i] === ON ? OFF : ON;
		cells[i] = paintValue;
	}

	function onpointermove(e: PointerEvent) {
		if (!painting) return;
		const i = cellAt(e);
		if (i != null) cells[i] = paintValue;
	}

	function stopPainting() {
		painting = false;
	}

	function clear() {
		cells = Array(ROWS * COLS).fill(OFF);
	}

	function invert() {
		cells = cells.map((c) => (c === ON ? OFF : ON));
	}

	async function copyModule() {
		try {
			await navigator.clipboard.writeText(toModuleSource(art));
			toast('Copied — paste it into the GitHub issue');
		} catch (err) {
			toast.error(`Copy failed: ${(err as Error).message}`);
		}
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
	class="overlay"
	role="button"
	tabindex="0"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label="Draw your own avatar"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={() => {}}
	>
		<div class="head">
			<h2>Draw your avatar</h2>
			<button class="x" onclick={onclose} aria-label="Close"><X size={16} /></button>
		</div>

		<div class="body">
			<div
				class="grid"
				bind:this={gridEl}
				role="img"
				aria-label="8 by 8 pixel drawing canvas"
				{onpointerdown}
				{onpointermove}
				onpointerup={stopPainting}
				onpointercancel={stopPainting}
				onlostpointercapture={stopPainting}
			>
				{#each cells as cell, i (i)}
					<span class="cell" class:on={cell === ON}></span>
				{/each}
			</div>

			<div class="side">
				<div class="preview">
					<div class="preview-label">Preview</div>
					<div class="preview-row">
						<Avatar {art} name={art.name} scale={6} />
						<Avatar {art} name={art.name} scale={3} />
					</div>
				</div>

				<label class="name-field">
					<span class="preview-label">Name</span>
					<input
						type="text"
						bind:value={avatarName}
						placeholder="dragon"
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
						autocomplete="off"
						maxlength="24"
					/>
				</label>

				<div class="tools">
					<Button size="sm" icon={Eraser} onclick={clear}>Clear</Button>
					<Button size="sm" icon={Contrast} onclick={invert}>Invert</Button>
				</div>
			</div>
		</div>

		<div class="foot">
			<span class="hint">Draw something, then open an issue to get it into the official set.</span>
			<div class="actions">
				<Button size="sm" icon={Copy} disabled={!canContribute} onclick={copyModule}>Copy</Button>
				<Button
					size="sm"
					variant="primary"
					icon={ExternalLink}
					disabled={!canContribute}
					href={toIssueUrl(art)}
					target="_blank"
					rel="noopener"
				>
					Open GitHub issue
				</Button>
			</div>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--ink) 50%, transparent);
		display: grid;
		place-items: center;
		padding: 24px;
		z-index: 50;
	}
	.modal {
		width: min(520px, 100%);
		display: flex;
		flex-direction: column;
		background: var(--bg-card);
		overflow: hidden;
		box-shadow: 8px 8px 0 var(--ink);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid var(--ink);
		background: var(--ink);
	}
	.head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--bg);
	}
	.x {
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		cursor: pointer;
		color: var(--bg);
	}
	.x:hover {
		opacity: 0.7;
	}
	.body {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		padding: 18px;
	}
	/* The canvas: an 8×8 board of fat LCD cells, same palette as Avatar's panel.
	   A stroke paints by pointer position, so cells need no individual handlers. */
	.grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		grid-template-rows: repeat(8, 1fr);
		width: 256px;
		height: 256px;
		flex: none;
		border: 1px solid var(--ink);
		background: var(--bg);
		cursor: crosshair;
		touch-action: none; /* drawing on touch shouldn't scroll the page */
	}
	.cell {
		box-sizing: border-box;
		padding: 0 1px 1px 0;
		background-clip: content-box;
		background-color: var(--rule-soft); /* unlit LED — faint */
	}
	.cell.on {
		background-color: var(--ink);
	}
	.side {
		flex: 1;
		min-width: 160px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.preview-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
		font-family: var(--font-mono);
	}
	.preview-row {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		margin-top: 6px;
	}
	.name-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.name-field input {
		font-family: var(--font-mono);
		font-size: 13px;
		padding: 8px 12px;
		border: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
	}
	.name-field input::placeholder {
		color: var(--ink-faint);
	}
	.name-field input:focus {
		outline: none;
		box-shadow: inset 3px 3px 0 var(--rule-soft);
	}
	.tools {
		display: flex;
		gap: 8px;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 14px 18px;
		border-top: 1px solid var(--ink);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
		flex: 1;
		min-width: 180px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.actions :global(.btn) {
		white-space: nowrap;
	}
</style>
