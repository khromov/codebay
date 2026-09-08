import { execInContainer, checkPresence } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';
import { getOption, setOption } from '../lib/db.server.ts';

// A standalone binary also works in project images without Node or with a root-owned npm prefix.
export const INSTALL_SCRIPT = `set -e
u="\${1:-\${_REMOTE_USER:-root}}"
h="$(getent passwd "$u" | cut -d: -f6)"
[ -n "$h" ] || h=/root
if command -v codex >/dev/null 2>&1 && [ "\${CODEBAY_CODEX_UPDATE:-0}" != 1 ]; then exit 0; fi
if command -v codex >/dev/null 2>&1; then
 current=$(codex --version 2>/dev/null | awk '{print $2}')
 if [ -z "\${CODEBAY_CODEX_VERSION:-}" ] || [ "$current" = "$CODEBAY_CODEX_VERSION" ]; then exit 0; fi
fi
case "$(uname -m)" in aarch64|arm64) arch=aarch64 ;; x86_64|amd64) arch=x86_64 ;; *) echo 'Unsupported Codex architecture' >&2; exit 1 ;; esac
asset="codex-$arch-unknown-linux-musl"
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
url="https://github.com/openai/codex/releases/latest/download/$asset.tar.gz"
if [ -n "\${CODEBAY_CODEX_VERSION:-}" ]; then url="https://github.com/openai/codex/releases/download/rust-v$CODEBAY_CODEX_VERSION/$asset.tar.gz"; fi
if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 --max-time 120 "$url" -o "$d/codex.tar.gz"
elif command -v wget >/dev/null 2>&1; then wget -q -T 120 "$url" -O "$d/codex.tar.gz"
else echo 'curl or wget is required to install Codex' >&2; exit 1; fi
tar -xzf "$d/codex.tar.gz" -C "$d"
"$d/$asset" --version
mkdir -p "$h/.local/bin"
chown "$u" "$h/.local" "$h/.local/bin"
install -m 755 "$d/$asset" "$h/.local/bin/codex.next"
mv -f "$h/.local/bin/codex.next" "$h/.local/bin/codex"
chown "$u" "$h/.local/bin/codex"
ln -sf "$h/.local/bin/codex" /usr/local/bin/codex
`;

async function latestVersion(): Promise<string | null> {
	const version = getOption('codex_latest_version');
	if (
		version &&
		/^\d+\.\d+\.\d+$/.test(version) &&
		Date.now() - Number(getOption('codex_latest_checked_at')) < 3_600_000
	)
		return version;
	try {
		const response = await fetch('https://registry.npmjs.org/@openai/codex/latest', {
			signal: AbortSignal.timeout(3000)
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { version?: unknown };
		if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) return null;
		setOption('codex_latest_version', data.version);
		setOption('codex_latest_checked_at', String(Date.now()));
		return data.version;
	} catch {
		return null;
	}
}

export const codexInstall: Injection = {
	id: 'codex-install',
	label: 'Codex CLI',
	async apply(target, log) {
		log('Installing/updating Codex CLI…\n');
		const version = await latestVersion();
		const result = await execInContainer(
			{ containerId: target.containerId },
			{
				script: `export CODEBAY_CODEX_UPDATE=1 CODEBAY_CODEX_VERSION=${version ?? ''}\n${INSTALL_SCRIPT}`,
				args: ['codex-install', target.remoteUser ?? 'root'],
				timeoutMs: 180_000
			}
		);
		log(
			result.ok
				? '✓ Codex CLI is up to date\n'
				: `⚠ Codex download failed; keeping any installed version: ${result.error}\n`
		);
	},
	check: (target) => checkPresence(target, 'codex --version >/dev/null 2>&1 && echo 1 || echo 0')
};
