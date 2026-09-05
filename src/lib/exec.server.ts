import { Writable } from 'node:stream';
import { getDocker } from './docker-client.server.ts';

export interface ExecTarget {
	containerId: string;
	remoteUser?: string | null;
}

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

const STDIN_ENV = '__CODEBAY_EXEC_STDIN';
const STDIN_VAR = 'CODEBAY_STDIN';

/**
 * Real exec stdin is unusable on Bun — dockerode's hijack path needs an `upgrade` event
 * Bun never emits, and `openStdin` needs full-duplex client HTTP Bun also lacks.
 */
function wrapWithStdin(script: string): string {
	// The carrier is an env var (never argv, so never in `ps`) and is unset so children don't inherit it.
	return `${STDIN_VAR}="$${STDIN_ENV}"; unset ${STDIN_ENV}\n${script}`;
}

/**
 * Resolves false on timeout. A host-side backstop only: the container process keeps running, so a
 * caller that needs the command itself killed must also wrap it in the container's own `timeout`.
 */
function streamEnded(stream: NodeJS.ReadableStream, timeoutMs?: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const timer = timeoutMs ? setTimeout(() => resolve(false), timeoutMs) : null;
		const settle = (fn: () => void) => {
			if (timer) clearTimeout(timer);
			fn();
		};
		stream.on('end', () => settle(() => resolve(true)));
		stream.on('error', (e) => settle(() => reject(e)));
	});
}

/**
 * The one place the `bash -lc` container-exec pattern lives; every injection goes through it.
 * `stdin` reaches the script as `$CODEBAY_STDIN`, and `args` as `$0`, `$1`, ….
 */
export async function execInContainer(
	target: ExecTarget,
	opts: { script: string; stdin?: string; args?: string[]; capture?: boolean; timeoutMs?: number }
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
			Tty: false // multiplexes stdout/stderr so the demux below can separate them
		});
		const stream = await exec.start({});

		const out = collector();
		const err = collector();
		exec.modem.demuxStream(stream, out.stream, err.stream);
		if (!(await streamEnded(stream, opts.timeoutMs))) {
			// Otherwise the exec socket and its demux collectors live on for as long as the command does.
			stream.destroy();
			return {
				ok: false,
				stdout: opts.capture ? out.text().trim() : '',
				error: `timed out after ${opts.timeoutMs}ms`
			};
		}

		const code = (await exec.inspect()).ExitCode ?? 1;
		const stdout = opts.capture ? out.text().trim() : '';
		return code === 0
			? { ok: true, stdout }
			: { ok: false, stdout, error: err.text().trim() || `exit ${code}` };
	} catch (e) {
		return { ok: false, stdout: '', error: (e as Error).message };
	}
}

/** The shape every injection's `check()` uses: a script that echoes `1` or `0`. */
export async function checkPresence(
	target: ExecTarget,
	script: string,
	args?: string[]
): Promise<boolean> {
	const res = await execInContainer(target, { script, args, capture: true });
	// The login shell's profile noise precedes the probe's echo, so only the last line counts.
	return res.ok && res.stdout.split('\n').at(-1)?.trim() === '1';
}
