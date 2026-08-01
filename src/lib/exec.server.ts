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
 * The one place the `bash -lc` container-exec pattern lives; every injection goes through it.
 * `stdin` reaches the script as `$CODEBAY_STDIN`, and `args` as `$0`, `$1`, ….
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
			Tty: false // multiplexes stdout/stderr so the demux below can separate them
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

/** The shape every injection's `check()` uses: a script that echoes `1` or `0`. */
export async function checkPresence(
	target: ExecTarget,
	script: string,
	args?: string[]
): Promise<boolean> {
	const res = await execInContainer(target, { script, args, capture: true });
	return res.ok && res.stdout === '1';
}
