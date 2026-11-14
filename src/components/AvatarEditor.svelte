<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Eraser from '@lucide/svelte/icons/eraser';
	import Contrast from '@lucide/svelte/icons/contrast';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import X from '@lucide/svelte/icons/x';
	import toast from 'svelte-french-toast';
	import { ROWS, COLS, ON, OFF, GRAY, decode, type AvatarArt } from '../avatars/types.ts';
	import { MODES, nextValue, type Mode } from '../avatars/editor.ts';
	import {
		cellsToPixels,
		normalizeName,
		toModuleSource,
		toIssueUrl
	} from '../avatars/serialize.ts';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';

	// Rolled by the route, not here, so hydration doesn't pick a different word.
	// `editing` seeds the canvas with an existing sprite (a redraw); null is a fresh draw.
	let {
		namePlaceholder,
		editing = null,
		oncancelEdit
	}: {
		namePlaceholder: string;
		editing?: AvatarArt | null;
		oncancelEdit?: () => void;
	} = $props();

	// A redraw keeps the sprite's name (it's the catalog key), so the name is fixed then.
	const isEdit = $derived(editing != null);

	// Same shape `decode()` produces, so the two round-trip. Seeded once — the parent
	// remounts this component (keyed) when it switches which sprite is being edited.
	let cells = $state<number[]>(editing ? decode(editing) : Array(ROWS * COLS).fill(OFF));
	let avatarName = $state(editing?.name ?? '');

	const slug = $derived(editing ? editing.name : normalizeName(avatarName));
	const art = $derived<AvatarArt>({ name: slug || 'my-avatar', pixels: cellsToPixels(cells) });
	// Contributing needs a name and at least one lit pixel — a blank sprite is no sprite.
	const canContribute = $derived(slug.length > 0 && cells.some((c) => c !== OFF));

	// Cycle is the default so both shades are reachable without switching mode.
	let mode = $state<Mode>('cycle');
	let modeButtons = $state<HTMLButtonElement[]>([]);

	// Roving-tabindex arrow navigation, as a radiogroup is expected to behave.
	function onModeKeydown(e: KeyboardEvent, i: number) {
		const dir =
			e.key === 'ArrowRight' || e.key === 'ArrowDown'
				? 1
				: e.key === 'ArrowLeft' || e.key === 'ArrowUp'
					? -1
					: 0;
		if (dir === 0) return;
		e.preventDefault();
		const next = (i + dir + MODES.length) % MODES.length;
		mode = MODES[next]!.id;
		modeButtons[next]?.focus();
	}

	// Capturing the pointer on the grid is what lets one stroke paint every cell it crosses.
	let gridEl = $state<HTMLDivElement | null>(null);
	let painting = false;
	let paintValue: number = ON;

	// Mirrors Avatar.svelte's bezel so the user sees the real framing while drawing.
	const RING_CELLS = Array.from({ length: 100 }, (_, i) => ({
		r: Math.floor(i / 10),
		c: i % 10
	})).filter(({ r, c }) => r === 0 || r === 9 || c === 0 || c === 9);

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
		paintValue = nextValue(mode, cells[i]!);
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

	// Only meaningful for a redraw: restore the sprite the edit started from.
	function reset() {
		if (editing) cells = decode(editing);
	}

	// Only swaps off↔on; gray sits in the middle and is left untouched.
	function invert() {
		cells = cells.map((c) => (c === ON ? OFF : c === OFF ? ON : c));
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

<section class="editor">
	<div class="head">
		<h2>{isEdit ? `Redraw “${editing!.name}”` : 'Draw your own avatar'}</h2>
		{#if isEdit}
			<button type="button" class="head-cancel" onclick={() => oncancelEdit?.()}>
				<X size={14} />
				<span>New drawing</span>
			</button>
		{/if}
	</div>

	<div class="body">
		<div class="grid-frame">
			{#each RING_CELLS as { r, c }, i (i)}
				<span class="ring-cell" style="grid-row:{r + 1};grid-column:{c + 1}" aria-hidden="true"
				></span>
			{/each}
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
					<span class="cell" class:on={cell === ON} class:gray={cell === GRAY}></span>
				{/each}
			</div>
		</div>

		<div class="side">
			<div class="preview">
				<div class="preview-label">Preview</div>
				<div class="preview-row">
					<Avatar {art} name={art.name} scale={6} />
					<Avatar {art} name={art.name} scale={3} />
				</div>
			</div>

			{#if isEdit}
				<!-- The AI-generated original, so the redraw can be compared against it at a glance. -->
				<div class="preview before">
					<div class="preview-label">Before</div>
					<div class="preview-row">
						<Avatar art={editing!} name={editing!.name} scale={3} />
					</div>
				</div>
			{/if}

			<label class="name-field">
				<span class="preview-label">Name</span>
				{#if isEdit}
					<!-- The name is the catalog key; a redraw keeps it, so it's shown read-only. -->
					<input type="text" value={editing!.name} readonly aria-readonly="true" />
				{:else}
					<input
						type="text"
						bind:value={avatarName}
						placeholder={namePlaceholder}
						spellcheck="false"
						autocapitalize="off"
						autocorrect="off"
						autocomplete="off"
						maxlength="24"
					/>
				{/if}
			</label>

			<div class="mode-field">
				<span class="preview-label">Mode</span>
				<div class="modes" role="radiogroup" aria-label="Drawing mode">
					{#each MODES as m, i (m.id)}
						<button
							type="button"
							class="mode"
							class:active={mode === m.id}
							role="radio"
							aria-checked={mode === m.id}
							tabindex={mode === m.id ? 0 : -1}
							bind:this={modeButtons[i]}
							onclick={() => (mode = m.id)}
							onkeydown={(e) => onModeKeydown(e, i)}
						>
							{m.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="tools">
				{#if isEdit}
					<Button size="sm" icon={RotateCcw} onclick={reset}>Reset</Button>
				{/if}
				<Button size="sm" icon={Eraser} onclick={clear}>Clear</Button>
				<Button size="sm" icon={Contrast} onclick={invert}>Invert</Button>
			</div>
		</div>
	</div>

	<div class="foot">
		<span class="hint">
			{isEdit
				? 'Redraw it, then open an issue to replace the AI-generated original.'
				: 'Draw something, then open an issue to get it into the official set.'}
		</span>
		<div class="actions">
			<Button size="sm" icon={Copy} disabled={!canContribute} onclick={copyModule}>Copy</Button>
			<Button
				size="sm"
				variant="primary"
				icon={ExternalLink}
				disabled={!canContribute}
				href={toIssueUrl(art, isEdit ? 'edit' : 'create')}
				target="_blank"
				rel="noopener"
			>
				Open GitHub issue
			</Button>
		</div>
	</div>
</section>

<style>
	.editor {
		width: 100%;
		display: flex;
		flex-direction: column;
		background: var(--bg-card);
		border: 1px solid var(--rule);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid var(--fill);
		background: var(--fill);
	}
	.head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fill-ink);
	}
	.head-cancel {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 5px 10px;
		border: 1px solid var(--fill-ink);
		background: transparent;
		color: var(--fill-ink);
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.head-cancel:hover {
		background: var(--fill-ink);
		color: var(--fill);
	}
	.head-cancel:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--rule-soft);
	}
	.body {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		padding: 18px;
	}
	.grid-frame {
		display: grid;
		grid-template-columns: repeat(10, 40px);
		grid-template-rows: repeat(10, 40px);
		width: 400px;
		height: 400px;
		flex: none;
		border: 1px solid var(--ink);
		background: var(--bg);
	}
	.ring-cell {
		box-sizing: border-box;
		padding: 0 1px 1px 0;
		background-clip: content-box;
		background-color: var(--rule-soft);
		opacity: var(--dim); /* more muted than the paintable off cells — not part of the art */
	}
	/* A stroke paints by pointer position, so cells need no individual handlers. */
	.grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		grid-template-rows: repeat(8, 1fr);
		grid-column: 2 / 10;
		grid-row: 2 / 10;
		cursor: crosshair;
		touch-action: none; /* drawing on touch shouldn't scroll the page */
	}
	.cell {
		box-sizing: border-box;
		padding: 0 1px 1px 0;
		background-clip: content-box;
		background-color: var(--rule-soft); /* unlit LED — faint */
	}
	.cell.gray {
		background-color: var(--led-gray); /* half-lit LED */
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
	.name-field input[readonly] {
		color: var(--ink-soft);
		cursor: default;
	}
	.name-field input:focus {
		outline: none;
		box-shadow: inset 3px 3px 0 var(--rule-soft);
	}
	.mode-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.modes {
		display: flex;
		border: 1px solid var(--ink);
	}
	.mode {
		flex: 1;
		padding: 7px 6px;
		border: none;
		border-right: 1px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.mode:last-child {
		border-right: none;
	}
	.mode.active {
		background: var(--fill);
		color: var(--fill-ink);
	}
	.mode:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--rule-soft);
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
