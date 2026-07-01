/**
 * Small host-process helper shared by the credential-locating injections.
 * Spawns a host binary, reads its trimmed stdout, and returns it only on a
 * clean (exit 0) run with non-empty output — otherwise null. Stderr is ignored;
 * a missing binary (spawn throws) is treated the same as a failed run.
 */
export async function spawnCapture(cmd: string[]): Promise<string | null> {
	try {
		const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' });
		const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		const value = out.trim();
		return code === 0 && value ? value : null;
	} catch {
		// Binary not installed on host, or spawn otherwise failed.
		return null;
	}
}
