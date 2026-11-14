import { linesPresent, SHELL_RC_FILES } from '../lib/container-files.server.ts';
import { execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** Markers bounding the manager-owned PATH block in the user's rc files. */
export const PATH_MARKER_START = '# >>> codebay path >>>';
export const PATH_MARKER_END = '# <<< codebay path <<<';

/**
 * Appends a PATH-restoring block to `~/.bashrc` and `~/.zshrc`.
 *
 * The block is generated *inside* the container from the script's own `$PATH`. `execInContainer`
 * execs `bash -lc` with the container's env, so that value is the **login** PATH: the image's
 * `ENV PATH` plus whatever `/etc/profile.d` adds, including the devcontainer CLI's
 * `00-restore-env.sh`. Non-login interactive shells never read those files, and code-server
 * (started by its feature's entrypoint via `su`, which resets PATH to `ENV_PATH`) hands them a
 * stripped PATH. That's why a second IDE terminal tab couldn't find a tool such as `claude` in
 * `/usr/local/share/npm-global/bin` while the tmux terminal (`$SHELL -l`) could.
 *
 * Each entry is re-added behind a `case` guard, so the block never duplicates an entry and is a
 * no-op in a shell that already has it. Missing entries are *appended* in login-PATH order (the
 * same shape as `00-restore-env.sh`'s own `PATH=$PATH:…`), so nothing the shell already resolves
 * gets shadowed. Only absolute entries are kept (an empty or `.` entry would put the cwd on
 * PATH), and entries containing a single quote are skipped rather than mis-quoted. `set -f` stops
 * the unquoted split from globbing an entry. The write is guarded by the start marker, so a
 * re-apply after a restart adds nothing, and a file lacking a trailing newline gets one first so
 * the marker can't glue itself onto the user's last line.
 *
 * `$1` overrides the target home (tests); the injection omits it to use the exec user's home.
 */
export const APPLY_SCRIPT = [
	'set -f;',
	'h="${1:-$(eval echo ~$(id -un))}";',
	`start='${PATH_MARKER_START}';`,
	'block=$(',
	'printf \'%s\\n\' "$start";',
	'printf \'%s\\n\' \'codebay_path_add() { case ":$PATH:" in *":$1:"*) ;; *) PATH="${PATH:+$PATH:}$1" ;; esac; }\';',
	'IFS=:;',
	'for d in $PATH; do',
	'case "$d" in /*) ;; *) continue ;; esac;',
	'case "$d" in *\\\'*) continue ;; esac;',
	'printf "codebay_path_add \'%s\'\\n" "$d";',
	'done;',
	'unset IFS;',
	`printf '%s\\n' 'export PATH' 'unset -f codebay_path_add' '${PATH_MARKER_END}'`,
	');',
	'rc=0;',
	'for f in "$h/.bashrc" "$h/.zshrc"; do',
	'grep -qF "$start" "$f" 2>/dev/null && continue;',
	'{ if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf \'\\n\'; fi; printf \'%s\\n\' "$block"; } >> "$f" || rc=1;',
	'done;',
	'exit $rc'
].join(' ');

/**
 * Makes the container's login PATH visible to plain interactive shells.
 *
 * Tools installed by devcontainer features or a project's Dockerfile often live on a directory
 * only the login PATH carries (`/usr/local/share/npm-global/bin`, `~/.local/bin`, …). Applied in
 * every mode; it has no host dependency.
 */
export const shellPath: Injection = {
	id: 'shell-path',
	label: 'shell PATH',

	async apply(target, log) {
		log('Restoring the login PATH for non-login shells…\n');
		const res = await execInContainer(target, { script: APPLY_SCRIPT, args: ['shell-path'] });
		log(res.ok ? '✓ shell PATH restored\n' : `⚠ shell PATH setup failed: ${res.error}\n`);
	},

	async check(target) {
		return linesPresent(target, SHELL_RC_FILES, [PATH_MARKER_START]);
	}
};
