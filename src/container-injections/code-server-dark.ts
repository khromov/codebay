import { checkPresence, execInContainer, type ExecTarget } from '../lib/exec.server.ts';
import { editJsonFile, readJsonFile } from '../lib/container-files.server.ts';
import { CODE_SERVER_SETTINGS } from '../lib/devcontainer.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Locates the bundled VS Code from the binary; shared prelude for the resolve and the check. */
const WALK_TO_BUNDLE =
	`p=$(command -v code-server) || exit 1; p=$(readlink -f "$p"); ` +
	`while [ "$p" != "/" ]; do for c in "$p" "$p/lib/vscode"; do `;

/**
 * Walks up from the resolved binary rather than assuming /usr/lib/code-server: the feature and the
 * standalone tarball put the wrapper at different depths, and only one of the two layouts keeps the
 * bundled VS Code directly above `bin/`. Prints the root on the last line — `bash -lc` runs profile
 * scripts whose stdout comes first, so callers must read the last line, never the whole capture.
 */
export const RESOLVE_ROOT_SCRIPT =
	WALK_TO_BUNDLE +
	`[ -d "$c/extensions/theme-defaults" ] && { printf '\\n%s\\n' "$c"; exit 0; }; done; ` +
	`p=$(dirname "$p"); done; exit 1`;

/**
 * Whitespace-tolerant because the shipped manifest is minified (`"uiTheme":"vs"`) while our own
 * rewrite pretty-prints it — a fixed-spacing pattern would miss the unpatched file and report green.
 * The closing quote is what keeps `"vs"` from also matching `"vs-dark"`.
 */
const LIGHT_UI_THEME_RE = '"uiTheme"[[:space:]]*:[[:space:]]*"(vs|hc-light)"';

/**
 * Resolve and probe in one exec: `check()` runs on every health tick, in the same `Promise.all` as
 * the `codeServerAccessible` probe that gates mounting the IDE iframe, so a second round trip here
 * would slow the boot-time fast cadence for no gain — the root can't move for a container's life.
 */
export const CHECK_SCRIPT =
	WALK_TO_BUNDLE +
	`m="$c/extensions/theme-defaults/package.json"; ` +
	`[ -f "$m" ] && { grep -qE '${LIGHT_UI_THEME_RE}' "$m" && echo 0 || echo 1; exit 0; }; done; ` +
	`p=$(dirname "$p"); done; echo 0`;

/**
 * The builtin-extension scan is cached against the mtime of the `extensions/` **directory**, which
 * rewriting a manifest inside it does not touch — so without invalidating both the cache file and
 * that mtime, the running server and the next window keep serving the pre-rewrite themes.
 */
const CLEAR_BUILTIN_CACHE =
	`rm -f ~/.local/share/code-server/CachedProfilesData/*/extensions.builtin.cache 2>/dev/null; ` +
	`exit 0`;

const SETTINGS_DIR = '$h/.local/share/code-server/User';

/**
 * VS Code matches `workbench.colorTheme` against a theme's *settingsId*, which is its manifest `id`
 * (the label is only a fallback for entries without one) — so this reads ids, never the nls labels.
 * The order tracks the build default (`ThemeSettingDefaults.COLOR_THEME_DARK`) across versions,
 * because pinning exactly that id is what lets the workbench paint its real dark colors before any
 * extension loads. Anything unrecognised falls back to whatever dark theme the build does ship.
 */
const PREFERRED_DARK_IDS = ['Dark 2026', 'Default Dark Modern', 'Dark Modern', 'Dark+'];

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

interface ThemeContribution {
	id?: string;
	uiTheme?: string;
	path?: string;
}

function themesOf(manifest: Record<string, unknown>): ThemeContribution[] | null {
	const contributes = manifest.contributes;
	if (typeof contributes !== 'object' || contributes === null) return null;
	const themes = (contributes as Record<string, unknown>).themes;
	return Array.isArray(themes) ? (themes as ThemeContribution[]) : null;
}

/** Null when the build ships no identifiable dark theme — better to leave the staged settings alone than pin an id nothing resolves. */
export function pickDarkThemeId(manifest: Record<string, unknown>): string | null {
	const ids = (themesOf(manifest) ?? [])
		.filter((t) => t?.uiTheme === 'vs-dark' && typeof t.id === 'string' && t.id.trim())
		.map((t) => t.id!.trim());
	if (!ids.length) return null;
	return PREFERRED_DARK_IDS.find((id) => ids.includes(id)) ?? ids[0]!;
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
	const themes = themesOf(manifest);
	if (!themes) return { next: manifest, changed: 0 };

	const pathFor = (ui: string) =>
		themes.find((t) => t?.uiTheme === ui && typeof t.path === 'string')?.path;
	const darkPath = pathFor('vs-dark');
	const hcDarkPath = pathFor('hc-black');

	let changed = 0;
	const nextThemes = themes.map((theme) => {
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

	const contributes = manifest.contributes as Record<string, unknown>;
	return {
		next: { ...manifest, contributes: { ...contributes, themes: nextThemes } },
		changed
	};
}

/** Only the writes need root; resolution runs as the remote user, whose PATH also carries a per-user standalone install. */
const rootTarget = (target: ExecTarget): ExecTarget => ({ containerId: target.containerId });

async function resolveRoot(target: ExecTarget): Promise<string | null> {
	const res = await execInContainer(target, { script: RESOLVE_ROOT_SCRIPT, capture: true });
	if (!res.ok) return null;
	const root = lastLine(res.stdout);
	return SAFE_PATH.test(root) ? root : null;
}

/**
 * VS Code Web's pre-extension paint falls back to `isWeb ? LIGHT : DARK` whenever it has no usable
 * cached theme, so pinning the theme in settings alone can never keep the first frame dark. This
 * closes both halves: it pins the theme id *this* build uses (so the workbench stops discarding its
 * own cache), and rewrites the bundled manifest so the light themes render dark if one is selected.
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
		const manifest = await readJsonFile(target, { dir: themeDir, name: 'package.json' });
		if (!manifest) {
			log('⚠ Could not read the bundled theme manifest — dark theme left to the staged settings\n');
			return;
		}

		const darkTheme = pickDarkThemeId(manifest);
		if (!darkTheme) {
			log('⚠ No dark theme found in the bundled manifest — staged settings left as they are\n');
		} else {
			// Seeded from the staged defaults so this still writes a complete file on the path where
			// the launcher's own copy silently failed, rather than a settings.json of three keys.
			const settings = await editJsonFile(
				target,
				{ dir: SETTINGS_DIR, name: 'settings.json' },
				(current) => ({
					...CODE_SERVER_SETTINGS,
					...current,
					...Object.fromEntries(THEME_KEYS.map((k) => [k, darkTheme]))
				})
			);
			log(
				settings.ok
					? `✓ Pinned code-server theme to "${darkTheme}"\n`
					: `⚠ Could not pin the code-server theme: ${settings.error}\n`
			);
		}

		if (darkenThemeManifest(manifest).changed === 0) {
			log('· No light themes to darken in this build\n');
			return;
		}
		const written = await editJsonFile(
			rootTarget(target),
			{ dir: themeDir, name: 'package.json' },
			(current) => darkenThemeManifest(current).next
		);
		if (!written.ok) {
			log(`⚠ Could not darken the built-in light themes: ${written.error}\n`);
			return;
		}
		await execInContainer(target, { script: CLEAR_BUILTIN_CACHE });
		// Bumping the scan's cache key; root because the bundled tree isn't the remote user's.
		await execInContainer(rootTarget(target), {
			script: `touch "${root}/extensions" 2>/dev/null; exit 0`
		});
		log('✓ Built-in light themes now render dark\n');
	},

	check(target) {
		return checkPresence(target, CHECK_SCRIPT);
	}
};
