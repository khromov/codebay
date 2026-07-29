#!/usr/bin/env bun
// Entry for `bunx codebay`. The server resolves htmlShell, SSR page components,
// ./public, and the .mochi manifest relative to process.cwd(), so chdir into the
// package root before booting. Dynamic import() of a relative specifier resolves
// against this module's URL (not cwd), so the chdir doesn't affect it.
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';

if (typeof Bun === 'undefined') {
	console.error('codebay requires Bun — run it with `bunx codebay` (https://bun.sh).');
	process.exit(1);
}

// config.server.ts resolves a relative DATA_DIR against process.cwd(). Pin it to the
// directory the user actually ran the command from, before the chdir below moves cwd
// into the (possibly npm-cached) package root.
if (process.env.DATA_DIR && !isAbsolute(process.env.DATA_DIR)) {
	process.env.DATA_DIR = resolve(process.cwd(), process.env.DATA_DIR);
}

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
await import('../src/index.ts');
