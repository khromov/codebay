// Preloaded before every test file (see bunfig.toml `[test].preload`).
//
// Guarantees tests never touch the real data dir. `config.server.ts` defaults an
// unset DATA_DIR to `~/.devcontainers-manager` (the production DB), and
// `db.server.ts` pins its SQLite handle to `globalThis` on first open — so under
// a single-process `bun test`, whichever module opens the DB first fixes the path
// for the whole run. Running this before any test module forces that path to a
// project-local, gitignored dir. Individual tests may still override DATA_DIR to
// their own temp dir before importing db.server; this is only the safe fallback.
if (!process.env.DATA_DIR) process.env.DATA_DIR = './.test-data';
