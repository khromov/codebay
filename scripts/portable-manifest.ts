/**
 * Make the built `.mochi/manifest.json` portable across machines.
 *
 * We ship the production build inside the npm tarball (Mochi only serves static
 * assets from a prebuilt manifest, so `bunx codebay` needs it). But
 * `ComponentRegistry.toManifest()` writes each component's compiled SSR module as an
 * **absolute** path on the build machine (`components[*].ssrModule`, plus the
 * framework-template lookup keys). `fromManifest()` then does `path.resolve(ssrModule)`
 * and `import()`s it — which on any other machine points at a path that doesn't exist,
 * so the server dies on boot. Locally it's worse than a clean failure: the path still
 * resolves to *this checkout*, so the installed package loads the repo's SSR modules and
 * ends up with two `svelte` module instances (`lifecycle_outside_component` during
 * island SSR).
 *
 * Everything else in the manifest (`clientFiles`, `publicFiles`, `serverIslandScript`)
 * is already cwd-relative, and `path.resolve` turns a relative entry into a correct
 * absolute one at runtime — the bin chdir's to the package root first. So the fix is
 * simply to strip the build root from every path under it.
 *
 * Runs as part of `bun run build`; safe to re-run (already-relative paths are untouched).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, '.mochi', 'manifest.json');
const prefix = root.endsWith('/') ? root : root + '/';

let raw: string;
try {
	raw = readFileSync(manifestPath, 'utf8');
} catch {
	console.error(`portable-manifest: no manifest at ${manifestPath} — run the build first.`);
	process.exit(1);
}

const rewritten = raw.replaceAll(prefix, '');
writeFileSync(manifestPath, rewritten);
console.log(
	`portable-manifest: ${raw.split(prefix).length - 1} build-root path(s) made relative in .mochi/manifest.json`
);

// Every field the runtime actually reads off disk must now be relative; an absolute one
// left over (i.e. pointing outside the build root) would break on another machine, so
// fail the build rather than shipping a manifest that only works here.
const manifest = JSON.parse(rewritten);
const diskPaths: string[] = [
	...Object.values(manifest.components ?? {}).map((c: any) => c.ssrModule),
	...Object.values(manifest.clientFiles ?? {}),
	...Object.values(manifest.publicFiles ?? {}),
	...Object.values(manifest.serverIslandPaths ?? {}),
	...Object.values(manifest.localImageAssets ?? {}).map((a: any) => a.diskPath),
	manifest.serverIslandScript
].filter((p): p is string => typeof p === 'string');

const absolute = [...new Set(diskPaths.filter((p) => p.startsWith('/')))];
if (absolute.length > 0) {
	console.error(
		`portable-manifest: ${absolute.length} absolute path(s) remain — the build is not portable:\n  ` +
			absolute.join('\n  ')
	);
	process.exit(1);
}
