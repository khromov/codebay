<script lang="ts">
	import { Toaster } from 'svelte-french-toast';

	/* The library paints a white bar and green/red icons from hardcoded hexes, so every
	   mount has to override them. Four routes render a Toaster (three of them outside
	   AppShell), hence one wrapper rather than four copies of the same options. Inline
	   styles are the only lever that reliably beats the library's own scoped rules. */
	const bar =
		'border:1px solid var(--edge); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--shadow); font-family:var(--font-mono); font-size:13px;';
	const glyph = 'var(--bg-card)';
</script>

<Toaster
	toastOptions={{
		style: bar,
		iconTheme: { primary: 'var(--ink-faint)', secondary: glyph },
		success: { iconTheme: { primary: 'var(--ok-line)', secondary: glyph } },
		error: { iconTheme: { primary: 'var(--danger)', secondary: glyph } }
	}}
/>
