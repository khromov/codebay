<script lang="ts">
	import { Toaster, type DefaultToastOptions } from 'svelte-french-toast';

	/* The library paints a white bar and green/red icons from hardcoded hexes, so every
	   mount has to override them. Four routes render a Toaster (three of them outside
	   AppShell), hence one wrapper rather than four copies of the same options. Inline
	   styles are the only lever that reliably beats the library's own scoped rules. */
	const glyph = 'var(--bg-card)';

	// Typed here rather than inline because Toaster's published prop type omits the
	// per-type keys that its own store reads.
	const options: DefaultToastOptions = {
		style:
			'border:1px solid var(--edge); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--shadow); font-family:var(--font-mono); font-size:13px;',
		iconTheme: { primary: 'var(--ink-faint)', secondary: glyph },
		success: { iconTheme: { primary: 'var(--ok-line)', secondary: glyph } },
		error: { iconTheme: { primary: 'var(--danger)', secondary: glyph } }
	};
</script>

<Toaster toastOptions={options} />
