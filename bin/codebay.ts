#!/usr/bin/env bun
// Entry for `bunx codebay`. The server resolves htmlShell, SSR page components,
// ./public, and the .mochi manifest relative to process.cwd(), so chdir into the
// package root before booting. Dynamic import() of a relative specifier resolves
// against this module's URL (not cwd), so the chdir doesn't affect it.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (typeof Bun === 'undefined') {
	console.error('codebay requires Bun — run it with `bunx codebay` (https://bun.sh).');
	process.exit(1);
}

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
await import('../src/index.ts');
