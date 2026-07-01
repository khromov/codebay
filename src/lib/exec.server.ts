import { Writable } from 'node:stream';
import { getDocker } from './docker-client.server.ts';

/** A running container to exec into, as its remote user (defaults to `root`). */
export interface ExecTarget {
	containerId: string;
	remoteUser?: string | null;
}

/** A node:stream sink that accumulates everything written into a string. */
function collector(): { stream: Writable; text: () => string } {
	const chunks: Buffer[] = [];
	return {
		stream: new Writable({
			write(chunk, _enc, cb) {
				chunks.push(Buffer.from(chunk));
				cb();
			}
		}),
		text: () => Buffer.concat(chunks).toString('utf8')
	};
}

/** Env var the exec carries the stdin secret in (see `wrapWithStdin`). */
const STDIN_ENV = '__DCM_EXEC_STDIN';
/** Non-exported shell var the wrapped script reads the secret from. */
const STDIN_VAR = 'DCM_STDIN';

/**
 * Expose `stdin` to the script as a scrubbed shell variable rather than the exec's
 * stdin stream.
 *
 * Real stdin streaming to a container exec is unusable on Bun: dockerode's hijack path
 * needs an HTTP `upgrade` event Bun never emits, and the non-hijack `openStdin` path
 * needs full-duplex client HTTP (writing the request body while reading the response),
 * which Bun's client also lacks. So the secret travels in the exec's `Env` (not argv —
 * it never shows up in `ps`); we copy it into a plain, non-exported shell variable
 * (`$DCM_STDIN`) and `unset` the exported carrier, so the script's child processes never
 * inherit the secret either. Scripts read `"$DCM_STDIN"` instead of stdin.
 */
function wrapWithStdin(script: string): string {
	return `${STDIN_VAR}="$${STDIN_ENV}"; unset ${STDIN_ENV}\n${script}`;
}

/**
 * Run a bash script inside a container as its remote user (defaulting to `root`).
 * This is the one place the `bash -lc <script>` container-exec pattern lives — every
 * container injection's `apply()`/`check()` goes through it. Runs over the Docker
 * Engine API (dockerode), no `docker exec` shell-out.
 *
 * Secrets are passed via `stdin` and read from the scrubbed `$DCM_STDIN` shell var in
 * the script, never on argv. Extra `args` are appended after the script and appear as `$0`, `$1`, …
 * inside it (used to pass non-secret context). Set `capture` to read stdout back;
 * stderr is always captured for error reporting.
 */
export async function execInContainer(
	target: ExecTarget,
	opts: { script: string; stdin?: string; args?: string[]; capture?: boolean }
): Promise<{ ok: boolean; stdout: string; error?: string }> {
	const user = target.remoteUser?.trim() || 'root';
	const hasStdin = opts.stdin !== undefined;
	try {
		const exec = await (await getDocker()).getContainer(target.containerId).exec({
			Cmd: [
				'bash',
				'-lc',
				hasStdin ? wrapWithStdin(opts.script) : opts.script,
				...(opts.args ?? [])
			],
			User: user,
			Env: hasStdin ? [`${STDIN_ENV}=${opts.stdin}`] : undefined,
			AttachStdout: true,
			AttachStderr: true,
			Tty: false // keep stdout/stderr separate (multiplexed) → demux below
		});
		const stream = await exec.start({});

		const out = collector();
		const err = collector();
		exec.modem.demuxStream(stream, out.stream, err.stream);
		await new Promise<void>((resolve, reject) => {
			stream.on('end', resolve);
			stream.on('error', reject);
		});

		const code = (await exec.inspect()).ExitCode ?? 1;
		const stdout = opts.capture ? out.text().trim() : '';
		return code === 0
			? { ok: true, stdout }
			: { ok: false, stdout, error: err.text().trim() || `exit ${code}` };
	} catch (e) {
		return { ok: false, stdout: '', error: (e as Error).message };
	}
}

/**
 * Run a presence-check script and resolve to whether it printed exactly `1`.
 * Every injection's `check()` follows the same shape — a script that echoes `1`
 * or `0` (e.g. via `[ -s "$f" ] && echo 1 || echo 0`), then
 * `res.ok && res.stdout === '1'` — so this collapses both into one call. `args`
 * are forwarded the same way as `execInContainer` (available as `$0`, `$1`, …).
 */
export async function checkPresence(
	target: ExecTarget,
	script: string,
	args?: string[]
): Promise<boolean> {
	const res = await execInContainer(target, { script, args, capture: true });
	return res.ok && res.stdout === '1';
}

/**
 * Shell snippet that ensures `dirExpr` exists and writes the scrubbed
 * `$DCM_STDIN` secret to `dirExpr/filename`, then chmods it. Shared by
 * injections that stage a single secret-only file (e.g. Claude Code's
 * `.credentials.json`) — must be run via `execInContainer` with `stdin` set.
 * Injections that combine the secret with non-secret content in one file
 * (e.g. GitHub CLI's `hosts.yml`, which is a header plus the token) build
 * their own write line instead, since there's nothing generic left to share.
 */
export function writeSecretFileScript(dirExpr: string, filename: string, mode = '600'): string {
	const path = `${dirExpr}/${filename}`;
	return `mkdir -p "${dirExpr}"; printf '%s' "$DCM_STDIN" > "${path}"; chmod ${mode} "${path}";`;
}
