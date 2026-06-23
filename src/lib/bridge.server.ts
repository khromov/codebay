import { BRIDGE_ALLOWED_TOOLS } from './config.server.ts';
import { getInstanceByBridgeToken } from './db.server.ts';

/**
 * Host-auth CLI bridge.
 *
 * Containers are throwaway copies of a host folder with no credentials of their
 * own. The bridge lets a small shim inside the container (installed as e.g.
 * `gh`, see BRIDGE_SHIM) forward each invocation to the host, where the *real*
 * tool runs with the host's authentication, and pipe the result back. No
 * long-lived secrets ever enter the container.
 *
 * Transport: the shim POSTs to `host.docker.internal:<PORT>/api/bridge/exec`
 * (reachable via the injected `--add-host=host.docker.internal:host-gateway`),
 * authenticating with a per-instance bearer token. Identity is the token alone:
 * it maps to an instance row, so the shim can't spoof which instance it is.
 *
 * Wire format (kept trivial so the shim needs only bash+curl+base64+sed):
 *  - Request: application/x-www-form-urlencoded with `tool`, repeated `arg`
 *    fields (in order), and an optional base64 `stdin` field. curl URL-encodes
 *    every value, so arguments with any bytes survive without JSON escaping.
 *  - Response: always HTTP 200 with a 3-line body — `<exitCode>\n<base64
 *    stdout>\n<base64 stderr>`. Errors (bad token, disallowed tool) are encoded
 *    the same way so the shim has one code path. base64 keeps stdout/stderr
 *    binary-safe and free of header size limits.
 */

/** Generate a fresh per-instance bridge bearer token. */
export function mintBridgeToken(): string {
  return crypto.randomUUID();
}

/** Encode a 3-line framed response: exit code, base64 stdout, base64 stderr. */
function framed(code: number, stdout: Uint8Array | string, stderr: string): Response {
  const body =
    `${code}\n` +
    `${Buffer.from(stdout).toString('base64')}\n` +
    `${Buffer.from(stderr).toString('base64')}`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
}

/** Read `Authorization: Bearer <token>` from a request, or '' if absent. */
function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Run an allowlisted host tool on behalf of a container and return its output.
 * Exempted from the global Basic Auth gate (see auth.server.ts) — the per-instance
 * bearer token is this endpoint's only authentication.
 */
export async function handleBridgeExec(request: Request): Promise<Response> {
  if (request.method !== 'POST') return framed(127, '', 'dcm-bridge: method not allowed\n');

  const instance = getInstanceByBridgeToken(bearer(request));
  if (!instance) return framed(127, '', 'dcm-bridge: unauthorized\n');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return framed(127, '', 'dcm-bridge: malformed request\n');
  }

  const tool = String(form.get('tool') ?? '');
  if (!BRIDGE_ALLOWED_TOOLS.has(tool)) {
    return framed(126, '', `dcm-bridge: '${tool}' is not permitted by the host bridge\n`);
  }

  // Bun.which avoids re-resolving through any host shim and fails clearly if the
  // tool isn't installed on the host.
  const bin = Bun.which(tool);
  if (!bin) return framed(127, '', `dcm-bridge: '${tool}' is not installed on the host\n`);

  const args = form.getAll('arg').map((a) => String(a));
  const stdinB64 = form.get('stdin');
  const stdin =
    typeof stdinB64 === 'string' && stdinB64 ? Buffer.from(stdinB64, 'base64') : undefined;

  try {
    const proc = Bun.spawn([bin, ...args], {
      cwd: instance.source_path,
      stdin: stdin ?? 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return framed(code, new Uint8Array(out), err);
  } catch (err) {
    return framed(1, '', `dcm-bridge: failed to run '${tool}' on host: ${(err as Error).message}\n`);
  }
}

/**
 * The in-container shim. Installed as /usr/local/bin/<tool> for each bridged
 * tool; it identifies which tool it is by its own basename. Depends only on
 * bash, curl, base64, and sed (present on the universal devcontainer image).
 */
export const BRIDGE_SHIM = `#!/usr/bin/env bash
# devcontainers-manager host CLI bridge shim.
# Forwards this command to the host, where the real tool runs with the host's
# auth, then replays its stdout/stderr/exit code here. Installed per tool name.
set -uo pipefail

tool="$(basename "$0")"

if [ -z "\${DCM_BRIDGE_URL:-}" ] || [ -z "\${DCM_BRIDGE_TOKEN:-}" ]; then
  echo "dcm-bridge: bridge not configured (DCM_BRIDGE_URL/DCM_BRIDGE_TOKEN unset)" >&2
  exit 127
fi

# tool + each argument; curl URL-encodes every value so any bytes are safe.
data=(--data-urlencode "tool=$tool")
for a in "$@"; do
  data+=(--data-urlencode "arg=$a")
done

# Forward piped stdin (if any) as base64; the host decodes and feeds the tool.
if [ ! -t 0 ]; then
  b64="$(base64 -w0 2>/dev/null || base64)"
  data+=(--data-urlencode "stdin=$b64")
fi

# Response body is 3 lines: exit code, base64(stdout), base64(stderr).
if ! resp="$(curl -sS --max-time 600 \\
  -H "Authorization: Bearer $DCM_BRIDGE_TOKEN" \\
  "\${data[@]}" \\
  "$DCM_BRIDGE_URL/api/bridge/exec")"; then
  echo "dcm-bridge: could not reach host bridge at $DCM_BRIDGE_URL" >&2
  exit 1
fi

code="$(printf '%s\\n' "$resp" | sed -n '1p')"
printf '%s\\n' "$resp" | sed -n '2p' | base64 -d 2>/dev/null || true
printf '%s\\n' "$resp" | sed -n '3p' | base64 -d 2>/dev/null >&2 || true
case "$code" in
  '' | *[!0-9]*) exit 1 ;;
  *) exit "$code" ;;
esac
`;
