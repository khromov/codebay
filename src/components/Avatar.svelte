<script lang="ts">
	import { pickAvatar, decode, type AvatarArt } from '../avatars/index.ts';

	// `id` selects the artwork (deterministic, stable per instance); `name` is for
	// accessibility. `art` lets a caller (e.g. the dev gallery) render a specific
	// sprite instead of picking. `scale` is device-pixels per LED cell — the panel
	// is always rendered at an integer multiple (10 × scale px) so every pixel
	// lands on a crisp boundary. e.g. scale 6 → 60×60.
	let {
		id = '',
		name,
		scale = 6,
		art,
		interactive = false
	}: {
		id?: string;
		name: string;
		scale?: number;
		art?: AvatarArt;
		interactive?: boolean;
	} = $props();

	// "LCD pressure" gag (only when `interactive`): pressing the panel inverts it
	// and blooms an oily iridescent splotch from the press point, then springs back
	// over ~250ms leaving a fading ghost — like squishing a real LCD.
	let pressed = $state(false);
	let ghosting = $state(false);
	let bx = $state('50%');
	let by = $state('50%');
	// Driven by the press position so the iridescent sheen shifts as you drag
	// across the panel: `spin` rotates which hues land where, `hue` shifts the
	// whole palette. A CSS transition eases between values for a liquid trail.
	let spin = $state(0);
	let hue = $state(0);
	let ghostTimer: ReturnType<typeof setTimeout> | undefined;

	// Position the bloom at the pointer (panel-relative percentages) and derive the
	// palette from where on the panel you are — so every pixel reads a bit different.
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
		if (pressed) aim(e); // drag the squish point around while held
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
	// A thin 0.5px gutter reads as a hairline LED gap (a crisp 1 device-pixel on
	// 2× displays). At 1× the cells are too small to spare any, so dots butt up.
	const gap = $derived(s >= 2 ? 0.5 : 0);

	// 64 on/off cells (0 off / 1 on), row-major, for the chosen 8×8 art.
	const cells = $derived(decode(art ?? pickAvatar(id)));
	// Frame the art in a 10×10 panel: the outer ring is unlit LED cells (a bezel
	// of real dots, not blank padding), the inner 8×8 holds the art. Row-major.
	const grid = $derived(
		Array.from({ length: 100 }, (_, i) => {
			const r = Math.floor(i / 10);
			const c = i % 10;
			const inner = r >= 1 && r <= 8 && c >= 1 && c <= 8;
			return inner ? cells[(r - 1) * 8 + (c - 1)] : 0;
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
	title={name}
	style="width:{10 * s}px;height:{10 *
		s}px;--gap:{gap}px;--bx:{bx};--by:{by};--spin:{spin}deg;--hue:{hue}deg"
	{onpointerdown}
	{onpointermove}
	onpointerup={release}
	onpointercancel={release}
	onlostpointercapture={release}
>
	{#each grid as cell, i (i)}
		<span class="px" class:on={cell === 1}></span>
	{/each}
	{#if interactive}
		<span class="invert" aria-hidden="true"></span>
		<span class="bloom" aria-hidden="true"></span>
	{/if}
</span>

<style>
	/* A 10×10 dot-matrix panel: each pixel is its own element. The outer ring is
     unlit LED cells framing the 8×8 art. The panel is sized to an exact
     10×scale so each cell is `scale` device-pixels — crisp, no sub-pixel blur.
     Monochrome LCD styling — lit dots are ink, unlit dots a faint tint. The LED
     gap is a per-cell gutter (see --gap) so it never throws off the integer
     cell size. */
	.avatar {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		grid-template-rows: repeat(10, 1fr);
		flex: none;
		border: 1px solid var(--ink);
		background: var(--bg);
	}
	.px {
		box-sizing: border-box;
		padding: 0 var(--gap) var(--gap) 0;
		background-clip: content-box;
		background-color: var(--rule-soft); /* unlit LED — faint */
	}
	.px.on {
		background-color: var(--ink);
	}

	/* --- "LCD pressure" press effect (opt-in via `interactive`) --- */
	/* Register the palette vars as <angle> so they can be smoothly transitioned —
     plain custom properties don't interpolate. */
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
	/* Localized inversion: a white layer in `difference` blend mode inverts whatever
     is behind it, and a radial alpha mask centered on the press point makes that
     inversion strongest at the center and fade to nothing toward the edges — so
     only a disc around your finger flips, like the pressure spot on a real LCD. */
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

	/* The squished-crystal splotch: a dark blotch + an oily iridescent ring, both
     centered on the press point (--bx/--by), blended over the inverted pixels. */
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
