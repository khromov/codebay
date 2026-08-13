/**
 * svelte-french-toast renders its own chrome, so every mount has to restate the
 * panel look. Shared here because the four mounts (AppShell, Settings, Avatars,
 * the /debug showcase) live on separate pages and silently drifted apart.
 */
export const TOAST_STYLE =
	'border:1px solid var(--edge); background:var(--bg-card); color:var(--ink); box-shadow:4px 4px 0 var(--shadow); font-family:var(--font-mono); font-size:13px;';

export const TOAST_OPTIONS = { style: TOAST_STYLE };
