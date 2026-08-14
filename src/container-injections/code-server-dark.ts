import { execInContainer, type ExecTarget } from '../lib/exec.server.ts';
import { editJsonFile, readJsonFile } from '../lib/container-files.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/**
 * Walks up from the resolved binary rather than assuming /usr/lib/code-server: the feature and the
 * standalone tarball put the wrapper at different depths, and only one of the two layouts keeps the
 * bundled VS Code directly above `bin/`. Prints the root on the last line — `bash -lc` runs profile
 * scripts whose stdout comes first, so callers must read the last line, never the whole capture.
 */
export const RESOLVE_ROOT_SCRIPT =
	`p=$(command -v code-server) || exit 1; p=$(readlink -f "$p"); ` +
	`while [ "$p" != "/" ]; do ` +
	`for c in "$p" "$p/lib/vscode"; do ` +
	`[ -d "$c/extensions/theme-defaults" ] && { printf '\\n%s\\n' "$c"; exit 0; }; done; ` +
	`p=$(dirname "$p"); done; exit 1`;

/** The exec user's own code-server state; the theme cache below must be dropped from it. */
const CACHED_EXTENSIONS = '~/.local/share/code-server/CachedExtensions';

const SETTINGS_DIR = '$h/.local/share/code-server/User';

/**
 * The settings value VS Code compares against is the theme's *label*, so it moves with the build:
 * 1.131 ships `Dark 2026`, older ones `Dark Modern`, older still the `Default …` spelling. Matching
 * it exactly is what stops the workbench discarding its own persisted theme on every boot.
 */
const DARK_LABEL_KEYS = ['dark2026ThemeLabel', 'darkModernThemeLabel'];

export const FALLBACK_DARK_THEME = 'Default Dark Modern';

const THEME_KEYS = [
	'workbench.colorTheme',
	'workbench.preferredDarkColorTheme',
	'workbench.preferredLightColorTheme'
];

/** A root path we are about to interpolate into a shell script, so nothing exotic may pass. */
const SAFE_PATH = /^\/[A-Za-z0-9._+\-/]+$/;

/** Mirrors `checkPresence`: only the last line is ours, everything before it is login-shell noise. */
function lastLine(stdout: string): string {
	return stdout.trimEnd().split('\n').pop()?.trim() ?? '';
}

export function pickDarkLabel(nls: Record<string, unknown> | null): string {
	for (const key of DARK_LABEL_KEYS) {
		const value = nls?.[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return FALLBACK_DARK_THEME;
}

interface ThemeContribution {
	uiTheme?: string;
	path?: string;
}

/**
 * Selecting by `uiTheme` rather than by filename is load-bearing: the light set is
 * 2026-light/light_modern/light_plus/light_vs *and* hc_light, so a `light*.json` glob silently
 * misses two of them. Repointing `path` too, since the light JSONs stay light on disk.
 */
export function darkenThemeManifest(manifest: Record<string, unknown>): {
	next: Record<string, unknown>;
	changed: number;
} {
	const contributes = manifest.contributes;
	if (typeof contributes !== 'object' || contributes === null)
		return { next: manifest, changed: 0 };
	const themes = (contributes as Record<string, unknown>).themes;
	if (!Array.isArray(themes)) return { next: manifest, changed: 0 };

	const darkPath = themes.find(
		(t: ThemeContribution) => t?.uiTheme === 'vs-dark' && typeof t.path === 'string'
	)?.path as string | undefined;
	const hcDarkPath = themes.find(
		(t: ThemeContribution) => t?.uiTheme === 'hc-black' && typeof t.path === 'string'
	)?.path as string | undefined;

	let changed = 0;
	const nextThemes = themes.map((theme: ThemeContribution) => {
		if (theme?.uiTheme === 'vs' && darkPath) {
			changed++;
			return { ...theme, uiTheme: 'vs-dark', path: darkPath };
		}
		if (theme?.uiTheme === 'hc-light' && hcDarkPath) {
			changed++;
			return { ...theme, uiTheme: 'hc-black', path: hcDarkPath };
		}
		return theme;
	});

	return {
		next: { ...manifest, contributes: { ...contributes, themes: nextThemes } },
		changed
	};
}

/**
 * Whitespace-tolerant because the shipped manifest is minified (`"uiTheme":"vs"`) while our own
 * rewrite pretty-prints it — a fixed-spacing pattern would miss the unpatched file and report green.
 * The closing quote is what keeps `"vs"` from also matching `"vs-dark"`.
 */
const LIGHT_UI_THEME_RE = '"uiTheme"[[:space:]]*:[[:space:]]*"(vs|hc-light)"';

export const checkScript = (root: string): string =>
	`m="${root}/extensions/theme-defaults/package.json"; ` +
	`[ -f "$m" ] && ! grep -qE '${LIGHT_UI_THEME_RE}' "$m" && echo 1 || echo 0`;

/** Root, since the bundled VS Code tree isn't owned by the remote user. */
const rootTarget = (target: ExecTarget): ExecTarget => ({ containerId: target.containerId });

async function resolveRoot(target: ExecTarget): Promise<string | null> {
	const res = await execInContainer(rootTarget(target), {
		script: RESOLVE_ROOT_SCRIPT,
		capture: true
	});
	if (!res.ok) return null;
	const root = lastLine(res.stdout);
	return SAFE_PATH.test(root) ? root : null;
}

/**
 * VS Code Web's pre-extension paint falls back to `isWeb ? LIGHT : DARK` whenever it has no usable
 * cached theme, so pinning the theme in settings alone can never keep the first frame dark. This
 * closes both halves: it writes the theme id *this* build uses (so the cache survives), and rewrites
 * the bundled manifest so the light themes render dark even if one is somehow selected.
 */
export const codeServerDark: Injection = {
	id: 'code-server-dark',
	label: 'code-server dark theme',
	// code-server-only; terminal-mode instances never run a workbench.
	modes: ['ide'],

	async apply(target, log) {
		log('Forcing code-server dark theme…\n');
		const root = await resolveRoot(target);
		if (!root) {
			log('⚠ code-server install not found — dark theme left to the staged settings\n');
			return;
		}

		const themeDir = `${root}/extensions/theme-defaults`;
		const nls = await readJsonFile(rootTarget(target), {
			dir: themeDir,
			name: 'package.nls.json'
		});
		const darkTheme = pickDarkLabel(nls);

		const settings = await editJsonFile(
			target,
			{ dir: SETTINGS_DIR, name: 'settings.json' },
			(current) => ({ ...current, ...Object.fromEntries(THEME_KEYS.map((k) => [k, darkTheme])) })
		);
		log(
			settings.ok
				? `✓ Pinned code-server theme to "${darkTheme}"\n`
				: `⚠ Could not pin the code-server theme: ${settings.error}\n`
		);

		const manifest = await editJsonFile(
			rootTarget(target),
			{ dir: themeDir, name: 'package.json' },
			(current) => darkenThemeManifest(current).next
		);
		if (!manifest.ok) {
			log(`⚠ Could not darken the built-in light themes: ${manifest.error}\n`);
			return;
		}
		// The manifest is cached per install, so the rewrite is invisible until the cache is dropped.
		await execInContainer(target, { script: `rm -rf ${CACHED_EXTENSIONS} 2>/dev/null || true` });
		log('✓ Built-in light themes now render dark\n');
	},

	async check(target) {
		const root = await resolveRoot(target);
		if (!root) return false;
		const res = await execInContainer(rootTarget(target), {
			script: checkScript(root),
			capture: true
		});
		return res.ok && lastLine(res.stdout) === '1';
	}
};
