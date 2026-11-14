#!/usr/bin/env bun
// Entry for `bunx codebay`. The server resolves htmlShell, SSR page components,
// ./public, and the .mochi manifest relative to process.cwd(), so chdir into the
// package root before booting. Dynamic import() of a relative specifier resolves
// against this module's URL (not cwd), so the chdir doesn't affect it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';

if (typeof Bun === 'undefined') {
	console.error('codebay requires Bun — run it with `bunx codebay` (https://bun.sh).');
	process.exit(1);
}

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readVersion(): string {
	try {
		return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
	console.log(readVersion());
	process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
	console.log(`codebay ${readVersion()} — spin up isolated devcontainers with a browser IDE.

Usage: bunx codebay [options]

Starts the web UI (default http://localhost:6969) and opens it in your browser.

Options:
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit

Environment variables:
  PORT                       Server port (default 6969)
  DATA_DIR                   Where state lives (default ~/.codebay)
  DOCKER_HOST                Docker socket/URL (defaults to your active Docker context)
  HOST                       Bind address (default 127.0.0.1; set 0.0.0.0 for LAN access)
  BASIC_AUTH_PASSWORD        Enable HTTP Basic Auth over the whole UI (required for 0.0.0.0)
  CODEBAY_CLAUDE_CODE_TOKEN  Claude Code token to inject into every container
  CODEBAY_GITHUB_TOKEN       GitHub token to inject into every container
  DISABLE_OPEN_BROWSER=1     Skip opening the browser on startup`);
	process.exit(0);
}

// config.server.ts resolves a relative DATA_DIR against process.cwd(). Pin it to the
// directory the user actually ran the command from, before the chdir below moves cwd
// into the (possibly npm-cached) package root.
if (process.env.DATA_DIR && !isAbsolute(process.env.DATA_DIR)) {
	process.env.DATA_DIR = resolve(process.cwd(), process.env.DATA_DIR);
}

process.chdir(pkgRoot);
await import('../src/index.ts');
