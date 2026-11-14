// Preloaded before every test file (see bunfig.toml `[test].preload`).
//
// Guarantees tests never touch the real data dir. `config.server.ts` defaults an
// unset DATA_DIR to `~/.codebay` (the production DB), and
// `db.server.ts` pins its SQLite handle to `globalThis` on first open — so under
// a single-process `bun test`, whichever module opens the DB first fixes the path
// for the whole run. Running this before any test module forces that path to a
// project-local, gitignored dir. Individual tests may still override DATA_DIR to
// their own temp dir before importing db.server; this is only the safe fallback.
//
// Wipe that dir first so every run starts from an empty DB. Because the handle is
// globalThis-pinned, a test's per-file DATA_DIR override loses to whoever opens the
// DB first, so rows it inserts land here and persist — a leftover `default_image`
// or an instance id would then collide on the next run. Doing this in preload (before
// any connection is open) avoids the "don't rmSync a live DATA_DIR mid-run" hazard.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = './.test-data';

if (!process.env.DATA_DIR) {
	// Absolute, because Bun on Windows fails a `./`-prefixed rmSync with ENOENT — which `force`
	// then swallows, silently skipping the wipe and surfacing much later as UNIQUE-constraint
	// failures in whichever test file inserts next. Retries cover a still-open app.sqlite, which
	// Windows refuses to unlink outright.
	rmSync(resolve(process.cwd(), DIR), {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100
	});
	process.env.DATA_DIR = DIR;
}
