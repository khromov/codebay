import { execInContainer, checkPresence } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';
import { getOption, setOption } from '../lib/db.server.ts';

export const COMPLETE_INSTALL_TEST = `b=$(command -v codex) && b=$(readlink -f "$b") && p=$(dirname "$(dirname "$b")") &&
test -s "$p/codex-package.json" && test -x "$p/bin/codex-code-mode-host" &&
test -x "$p/codex-path/rg" && test -x "$p/codex-resources/bwrap" && test -x "$p/codex-resources/zsh/bin/zsh"`;

// The native package includes sibling helpers and resources that the standalone binary needs.
export const INSTALL_SCRIPT = `set -e
u="\${1:-\${_REMOTE_USER:-root}}"
h="$(getent passwd "$u" | cut -d: -f6)"
[ -n "$h" ] || h=/root
complete_install() { ${COMPLETE_INSTALL_TEST}; }
if complete_install; then
 if [ "\${CODEBAY_CODEX_UPDATE:-0}" != 1 ]; then exit 0; fi
 current=$(codex --version 2>/dev/null | awk '{print $2}')
 if [ -z "\${CODEBAY_CODEX_VERSION:-}" ] || [ "$current" = "$CODEBAY_CODEX_VERSION" ]; then exit 0; fi
fi
case "$(uname -m)" in aarch64|arm64) arch=aarch64 ;; x86_64|amd64) arch=x86_64 ;; *) echo 'Unsupported Codex architecture' >&2; exit 1 ;; esac
asset="codex-package-$arch-unknown-linux-musl"
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
url="https://github.com/openai/codex/releases/latest/download/$asset.tar.gz"
if [ -n "\${CODEBAY_CODEX_VERSION:-}" ]; then url="https://github.com/openai/codex/releases/download/rust-v$CODEBAY_CODEX_VERSION/$asset.tar.gz"; fi
if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 --max-time 120 "$url" -o "$d/codex.tar.gz"
elif command -v wget >/dev/null 2>&1; then wget -q -T 120 "$url" -O "$d/codex.tar.gz"
else echo 'curl or wget is required to install Codex' >&2; exit 1; fi
tar -xzf "$d/codex.tar.gz" -C "$d"
"$d/bin/codex" --version
test -x "$d/bin/codex-code-mode-host"
test -s "$d/codex-package.json"
test -x "$d/codex-path/rg"
test -x "$d/codex-resources/bwrap"
test -x "$d/codex-resources/zsh/bin/zsh"
mkdir -p "$h/.local/bin" "$h/.local/share/codebay/codex"
chown "$u" "$h/.local" "$h/.local/bin" "$h/.local/share" "$h/.local/share/codebay" "$h/.local/share/codebay/codex"
package=$(mktemp -d "$h/.local/share/codebay/codex/release.XXXXXX")
mv "$d/bin" "$d/codex-package.json" "$d/codex-path" "$d/codex-resources" "$package/"
chown -R "$u" "$package"
ln -sf "$package/bin/codex-code-mode-host" "$h/.local/bin/codex-code-mode-host"
ln -sf "$package/bin/codex" "$h/.local/bin/codex.next"
mv -f "$h/.local/bin/codex.next" "$h/.local/bin/codex"
ln -sf "$h/.local/bin/codex" /usr/local/bin/codex
ln -sf "$h/.local/bin/codex-code-mode-host" /usr/local/bin/codex-code-mode-host
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
	check: (target) =>
		checkPresence(
			target,
			`{ ${COMPLETE_INSTALL_TEST}; } && codex --version >/dev/null 2>&1 && echo 1 || echo 0`
		)
};
