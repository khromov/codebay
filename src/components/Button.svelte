<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	type Variant = 'default' | 'primary' | 'danger';
	type Size = 'sm' | 'md' | 'lg';

	let {
		variant = 'default',
		size = 'md',
		ghost = false,
		square = false,
		icon,
		iconSize,
		href,
		disabled = false,
		onclick,
		children,
		...rest
	}: {
		variant?: Variant;
		size?: Size;
		/** Dashed-outline treatment that fills on hover — used for secondary links. */
		ghost?: boolean;
		/** Icon-only: drops the padding for a square that matches the row's button height. */
		square?: boolean;
		/** Optional leading icon component, e.g. a lucide icon like `Plus`. */
		icon?: Component<{ size?: number }>;
		/** Override the icon size; defaults to a size that scales with `size`. */
		iconSize?: number;
		/** When set, the button renders as an `<a>` link instead of a `<button>`. */
		href?: string;
		disabled?: boolean;
		onclick?: (e: MouseEvent) => void;
		children?: Snippet;
		[key: string]: unknown;
	} = $props();

	const Icon = $derived(icon);
	const resolvedIconSize = $derived(iconSize ?? (size === 'lg' ? 18 : size === 'sm' ? 13 : 15));
</script>

{#if href}
	<a
		class="btn {variant} {size}"
		class:ghost
		class:square
		href={disabled ? undefined : href}
		aria-disabled={disabled || undefined}
		tabindex={disabled ? -1 : undefined}
		{...rest}
	>
		{#if Icon}<Icon size={resolvedIconSize} />{/if}
		{@render children?.()}
	</a>
{:else}
	<button class="btn {variant} {size}" class:ghost class:square {onclick} {disabled} {...rest}>
		{#if Icon}<Icon size={resolvedIconSize} />{/if}
		{@render children?.()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		font-family: var(--font-mono);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border: 1px solid var(--ink);
		background: var(--bg-card);
		color: var(--ink);
		cursor: pointer;
		text-decoration: none;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	/* `disabled` has no native effect on an <a> — the href branch above drops the
     href entirely when disabled, but it still needs the same visual treatment
     and to be excluded from the tab order / assistive-tech actions. */
	.btn[aria-disabled='true'] {
		opacity: 0.4;
		cursor: not-allowed;
		pointer-events: none;
	}

	.btn.sm {
		padding: 7px 12px;
		font-size: 12px;
	}
	.btn.md {
		padding: 9px 16px;
		font-size: 13px;
	}
	.btn.lg {
		padding: 12px 22px;
		font-size: 15px;
	}

	/* Sized to match the text button of the same `size`, so the two sit flush in a row. */
	.btn.square {
		padding: 0;
	}
	.btn.square.sm {
		width: 30px;
		height: 30px;
	}
	.btn.square.md {
		width: 35px;
		height: 35px;
	}
	.btn.square.lg {
		width: 44px;
		height: 44px;
	}

	.btn.default:hover:not(:disabled) {
		background: var(--ink);
		color: var(--bg);
	}

	.btn.primary {
		font-weight: 700;
		background: var(--ink);
		color: var(--bg);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--bg-card);
		color: var(--ink);
	}

	.btn.ghost {
		background: transparent;
		border-style: dashed;
	}
	.btn.ghost:hover:not(:disabled) {
		background: var(--ink);
		color: var(--bg);
		border-style: solid;
	}

	.btn.danger {
		color: var(--danger);
		border-color: var(--danger);
	}
	.btn.danger:hover:not(:disabled) {
		color: var(--danger);
		background-color: var(--danger-soft);
		border-color: transparent;
		/* Slowly marching red "ants" border, drawn as four animated edge gradients. */
		background-image:
			linear-gradient(90deg, var(--danger) 50%, transparent 0),
			linear-gradient(90deg, var(--danger) 50%, transparent 0),
			linear-gradient(0deg, var(--danger) 50%, transparent 0),
			linear-gradient(0deg, var(--danger) 50%, transparent 0);
		background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
		background-size:
			14px 2px,
			14px 2px,
			2px 14px,
			2px 14px;
		background-position:
			0 0,
			0 100%,
			0 0,
			100% 0;
		animation: marching-ants 2s linear infinite;
	}
	@keyframes marching-ants {
		to {
			background-position:
				28px 0,
				-28px 100%,
				0 -28px,
				100% 28px;
		}
	}
</style>
