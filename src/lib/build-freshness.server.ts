import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface BuildManifest {
	components?: Record<string, { hydratables?: { resolvedPath?: string }[] }>;
	stats?: { outputs?: { inputs?: { path?: string }[] }[] };
}

/** Every project file the build consumed: pages, islands, and each client bundle's inputs. */
function buildInputs(manifest: BuildManifest): string[] {
	const paths = new Set<string>();
	for (const [source, component] of Object.entries(manifest.components ?? {})) {
		paths.add(source);
		for (const island of component.hydratables ?? []) {
			if (island.resolvedPath) paths.add(island.resolvedPath);
		}
	}
	for (const output of manifest.stats?.outputs ?? []) {
		for (const input of output.inputs ?? []) {
			if (input.path) paths.add(input.path);
		}
	}
	// Dependencies, Mochi's own templates, and virtual modules are not things anyone edits in place.
	return [...paths].filter(
		(p) => !p.startsWith('node_modules/') && !p.startsWith('$mochi/') && !p.includes(':')
	);
}

/**
 * Build inputs edited since the manifest was written, relative to `root`. Only files the manifest
 * itself names count, so editing a `.server.ts` (imported from source at boot) never trips it.
 */
export function staleBuildInputs(
	root: string,
	manifestPath = join(root, '.mochi', 'manifest.json')
): string[] {
	if (!existsSync(manifestPath)) return [];
	const builtAt = statSync(manifestPath).mtimeMs;
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BuildManifest;
	return buildInputs(manifest)
		.filter((p) => {
			const abs = join(root, p);
			return existsSync(abs) && statSync(abs).mtimeMs > builtAt;
		})
		.sort();
}

/**
 * Production serves pages and islands from the prebuilt manifest but imports routes from source,
 * so restarting after a `.svelte` edit without `bun run build` splits the app: new API, old client.
 * Gated on a checkout because a package install stamps every file with its extraction time.
 */
export function warnIfBuildStale(root = process.cwd()): void {
	if (process.env.MODE === 'development' || !existsSync(join(root, '.git'))) return;
	const stale = staleBuildInputs(root);
	if (stale.length === 0) return;
	const listed = stale.slice(0, 5).join(', ') + (stale.length > 5 ? ', …' : '');
	console.warn(
		`⚠ .mochi/ is older than ${stale.length} source file(s) it was built from (${listed}) — ` +
			'production serves the prebuilt bundle, so run `bun run build` and restart, or pages and islands will be stale.'
	);
}
