<script lang="ts">
	import { decode, type AvatarArt } from '../avatars/index.ts';

	// `scale` is device-pixels per LED cell; the panel is always an integer multiple
	// of it (10 × scale px) so every pixel lands on a crisp boundary.
	let {
		name,
		scale = 6,
		art,
		interactive = false
	}: {
		name: string;
		scale?: number;
		art?: AvatarArt | null;
		interactive?: boolean;
	} = $props();

	// The "LCD pressure" gag: pressing the panel squishes it like a real LCD.
	let pressed = $state(false);
	let ghosting = $state(false);
	let bx = $state('50%');
	let by = $state('50%');
	// Driven by press position so the sheen shifts as you drag; a CSS transition eases the trail.
	let spin = $state(0);
	let hue = $state(0);
	let ghostTimer: ReturnType<typeof setTimeout> | undefined;

	// Deriving the palette from position is what makes every pixel read a bit different.
	function aim(e: PointerEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const px = (e.clientX - rect.left) / rect.width;
		const py = (e.clientY - rect.top) / rect.height;
		bx = px * 100 + '%';
		by = py * 100 + '%';
		// Non-linear mix of x and y so dragging sweeps the palette in interesting ways.
		hue = (px * 360 + py * 140) % 360;
		spin = (py * 300 - px * 120 + 360) % 360;
	}

	function onpointerdown(e: PointerEvent) {
		if (!interactive) return;
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		aim(e);
		clearTimeout(ghostTimer);
		ghosting = false;
		pressed = true;
	}

	function onpointermove(e: PointerEvent) {
		if (pressed) aim(e);
	}

	function release() {
		if (!pressed) return;
		pressed = false;
		ghosting = true;
		clearTimeout(ghostTimer);
		ghostTimer = setTimeout(() => (ghosting = false), 250);
	}

	$effect(() => () => clearTimeout(ghostTimer));

	// Clamp to a whole number ≥ 1 — fractional scales would blur the grid.
	const s = $derived(Math.max(1, Math.round(scale)));
	// 0.5px is a crisp single device-pixel at 2×; at 1× the cells can't spare any gutter.
	const gap = $derived(s >= 2 ? 0.5 : 0);

	// Instance sprites are resolved server-side and handed in as `art`; a missing or unknown one
	// (null/unset) renders an empty panel rather than a colliding fallback.
	const resolved = $derived(art ?? null);
	const cells = $derived(resolved ? decode(resolved) : []);
	// The 10×10 outer ring is unlit LED cells — a bezel of real dots, not blank padding.
	const grid = $derived(
		Array.from({ length: 100 }, (_, i) => {
			const r = Math.floor(i / 10);
			const c = i % 10;
			const inner = r >= 1 && r <= 8 && c >= 1 && c <= 8;
			return inner ? (cells[(r - 1) * 8 + (c - 1)] ?? 0) : 0;
		})
	);
</script>

<span
	class="avatar"
	class:interactive
	class:pressed
	class:ghosting
	role="img"
	aria-label={name}
	title={resolved?.name}
	style="width:{10 * s}px;height:{10 *
		s}px;--gap:{gap}px;--bx:{bx};--by:{by};--spin:{spin}deg;--hue:{hue}deg"
	{onpointerdown}
	{onpointermove}
	onpointerup={release}
	onpointercancel={release}
	onlostpointercapture={release}
>
	{#each grid as cell, i (i)}
		<span class="px" class:on={cell === 1} class:gray={cell === 2}></span>
	{/each}
	{#if interactive}
		<span class="invert" aria-hidden="true"></span>
		<span class="bloom" aria-hidden="true"></span>
	{/if}
</span>

<style>
	/* Sized to an exact 10×scale so each cell is a whole number of device-pixels.
	   The LED gap is a per-cell gutter, which keeps that integer cell size intact. */
	.avatar {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		grid-template-rows: repeat(10, 1fr);
		flex: none;
		border: 1px solid var(--edge);
		background: var(--bg);
	}
	.px {
		box-sizing: border-box;
		padding: 0 var(--gap) var(--gap) 0;
		background-clip: content-box;
		background-color: var(--rule-soft); /* unlit LED — faint */
	}
	.px.gray {
		background-color: var(--led-gray); /* half-lit LED */
	}
	.px.on {
		background-color: var(--ink);
	}

	/* Registered as <angle> because plain custom properties don't interpolate. */
	@property --hue {
		syntax: '<angle>';
		inherits: false;
		initial-value: 0deg;
	}
	@property --spin {
		syntax: '<angle>';
		inherits: false;
		initial-value: 0deg;
	}
	.avatar.interactive {
		position: relative;
		cursor: pointer;
		touch-action: none; /* a touch-press shouldn't scroll the page */
	}
	/* A white `difference` layer inverts what's behind it; the radial mask is what
	   confines the inversion to a disc around the press point. */
	.invert {
		position: absolute;
		inset: 0;
		pointer-events: none;
		opacity: 0;
		background: #fff;
		mix-blend-mode: difference;
		-webkit-mask: radial-gradient(
			circle at var(--bx) var(--by),
			rgba(0, 0, 0, 1) 0%,
			rgba(0, 0, 0, 0.92) 24%,
			rgba(0, 0, 0, 0) 58%
		);
		mask: radial-gradient(
			circle at var(--bx) var(--by),
			rgba(0, 0, 0, 1) 0%,
			rgba(0, 0, 0, 0.92) 24%,
			rgba(0, 0, 0, 0) 58%
		);
	}
	.avatar.pressed .invert {
		opacity: 1;
	}
	.avatar.ghosting .invert {
		opacity: 0;
		transition: opacity 250ms ease-out;
	}

	/* The squished-crystal splotch, centered on --bx/--by over the inverted pixels. */
	.bloom {
		position: absolute;
		inset: 0;
		pointer-events: none;
		opacity: 0;
		mix-blend-mode: screen;
		/* Palette derived from press position; ease between states for a liquid trail. */
		filter: hue-rotate(var(--hue, 0deg));
		transition:
			--hue 350ms ease-out,
			--spin 350ms ease-out;
		background:
			conic-gradient(
				from var(--spin, 0deg) at var(--bx) var(--by),
				#ff0080,
				#ffae00,
				#00ff6a,
				#00b3ff,
				#7a00ff,
				#ff0080
			),
			radial-gradient(
				circle at var(--bx) var(--by),
				rgba(13, 14, 10, 0.85) 0%,
				rgba(13, 14, 10, 0.4) 18%,
				transparent 45%
			);
		/* Mask the rainbow conic into a ring around the press point. */
		-webkit-mask: radial-gradient(
			circle at var(--bx) var(--by),
			transparent 8%,
			#000 26%,
			#000 38%,
			transparent 60%
		);
		mask: radial-gradient(
			circle at var(--bx) var(--by),
			transparent 8%,
			#000 26%,
			#000 38%,
			transparent 60%
		);
	}
	.avatar.pressed .bloom {
		opacity: 0.45;
	}
	.avatar.ghosting .bloom {
		opacity: 0;
		transition: opacity 250ms ease-out;
	}

	@media (prefers-reduced-motion: no-preference) {
		.avatar.interactive {
			transition: transform 250ms ease-out;
		}
		.avatar.pressed {
			transform: scale(0.97);
			transition: transform 60ms ease-out;
		}
	}
</style>
