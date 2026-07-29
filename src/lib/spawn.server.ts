/** Null on anything short of a clean run with output, so callers need no error branch. */
export async function spawnCapture(
	cmd: string[],
	opts?: { env?: Record<string, string | undefined> }
): Promise<string | null> {
	try {
		const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore', env: opts?.env });
		const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		const value = out.trim();
		return code === 0 && value ? value : null;
	} catch {
		return null; // binary not installed on the host
	}
}
