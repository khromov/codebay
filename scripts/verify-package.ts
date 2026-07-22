/**
 * Pre-publish smoke test: pack the tarball, install it into a throwaway project, and
 * boot it there in production mode — the same thing `bunx codebay@latest` does.
 *
 * This exists because the failure modes of this package are invisible from the repo:
 * the app resolves `./src/shell.html`, `./.mochi`, and `./public` against cwd, and the
 * built manifest has embedded disk paths. A build that works perfectly via `bun start`
 * can still be dead on arrival once installed somewhere else. Run it after `bun run
 * build`; the release workflow runs it right before `npm publish`.
 *
 * Checks: the SSR page renders, a static asset from the prebuilt manifest is served,
 * no island SSR errors are logged, and no manifest disk path escapes the package.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const work = mkdtempSync(join(tmpdir(), 'codebay-verify-'));
let server: ReturnType<typeof spawn> | undefined;

/** Run a command to completion, returning its combined output; throws on failure. */
async function run(cmd: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	if ((await proc.exited) !== 0) {
		throw new Error(`${cmd.join(' ')} failed:\n${out}\n${err}`);
	}
	return out + err;
}

try {
	// 1. Pack whatever is currently built + committed.
	const packOut = await run(['bun', 'pm', 'pack', '--destination', work], root);
	const tarball = packOut.match(/^.*\.tgz$/m)?.[0].trim();
	if (!tarball) throw new Error(`could not find the packed tarball in:\n${packOut}`);
	console.log(`verify-package: packed ${tarball.replace(work + '/', '')}`);

	// 2. Install it into an empty project, exactly like a user would.
	const project = join(work, 'project');
	mkdirSync(project);
	writeFileSync(
		join(project, 'package.json'),
		JSON.stringify({ name: 'codebay-verify', private: true }, null, 2)
	);
	await run(['bun', 'add', tarball], project);

	// 3. Boot it from the project dir (NOT the repo) in production mode.
	const port = 8100 + Math.floor((Date.now() / 1000) % 700);
	const log: string[] = [];
	server = spawn(join(project, 'node_modules', '.bin', 'codebay'), {
		cwd: project,
		env: {
			...process.env,
			MODE: '',
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: join(project, 'state'),
			DISABLE_OPEN_BROWSER: '1'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	server.stdout?.on('data', (d) => log.push(String(d)));
	server.stderr?.on('data', (d) => log.push(String(d)));

	const base = `http://127.0.0.1:${port}`;
	let html: string | undefined;
	for (let i = 0; i < 60; i++) {
		const res = await fetch(base + '/').catch(() => null);
		if (res?.ok) {
			html = await res.text();
			break;
		}
		if (server.exitCode != null) {
			throw new Error(`server exited with code ${server.exitCode}:\n${log.join('')}`);
		}
		await Bun.sleep(500);
	}

	// 4. Assert on what the installed copy actually served.
	if (html == null) {
		fail(`server never answered on ${base} within 30s:\n${log.join('')}`);
	} else if (!html.includes('<title>')) {
		fail('the served page has no <title> — SSR did not render the shell');
	}

	const wav = await fetch(`${base}/sounds/done.wav`).catch(() => null);
	if (!wav?.ok) {
		fail(
			`/sounds/done.wav returned ${wav?.status ?? 'nothing'} — the packed .mochi manifest is not serving static assets`
		);
	}

	const islandErrors = log.join('').match(/Island SSR error.*/g);
	if (islandErrors) {
		fail(
			`the installed package logged island SSR errors (usually a manifest pointing at another checkout's modules):\n  ${islandErrors.join('\n  ')}`
		);
	}

	// 5. Every disk path in the shipped manifest must stay inside the package.
	const manifest: {
		components?: Record<string, { ssrModule?: string }>;
		clientFiles?: Record<string, string>;
		publicFiles?: Record<string, string>;
		serverIslandScript?: string;
	} = JSON.parse(
		readFileSync(join(project, 'node_modules', 'codebay', '.mochi', 'manifest.json'), 'utf8')
	);
	const diskPaths: string[] = [
		...Object.values(manifest.components ?? {}).map((c) => c.ssrModule),
		...Object.values(manifest.clientFiles ?? {}),
		...Object.values(manifest.publicFiles ?? {}),
		manifest.serverIslandScript
	].filter((p): p is string => typeof p === 'string');
	const escaped = [...new Set(diskPaths.filter((p) => p.startsWith('/') || p.startsWith('..')))];
	if (escaped.length > 0) {
		fail(`shipped manifest references paths outside the package:\n  ${escaped.join('\n  ')}`);
	}
} catch (err) {
	fail((err as Error).message);
} finally {
	server?.kill('SIGTERM');
	rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
	console.error(`verify-package: FAILED\n- ${failures.join('\n- ')}`);
	process.exit(1);
}
console.log('verify-package: OK — packed tarball boots, renders, and serves static assets');
