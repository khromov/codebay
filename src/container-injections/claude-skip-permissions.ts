import { checkPresence, execInContainer } from '../lib/exec.server.ts';
import type { Injection } from '../lib/injections.server.ts';

/** The alias line appended to the container user's shell rc files. */
const ALIAS_LINE = "alias claude='claude --dangerously-skip-permissions'";

/**
 * Append the alias to both `~/.bashrc` and `~/.zshrc`, guarded with `grep -qF`
 * so a re-apply never duplicates the line; `>>` creates the file if absent.
 * Each shell ends up sourcing the alias from whichever rc it reads.
 */
const APPLY_SCRIPT =
  'h=$(eval echo ~$(id -un)); ' +
  `line="${ALIAS_LINE}"; ` +
  'for f in "$h/.bashrc" "$h/.zshrc"; do ' +
  'grep -qF "$line" "$f" 2>/dev/null || printf \'%s\\n\' "$line" >> "$f"; ' +
  'done';

/** True when the alias line is present in either rc file. */
const CHECK_SCRIPT =
  'h=$(eval echo ~$(id -un)); ' +
  `line="${ALIAS_LINE}"; ` +
  'if grep -qF "$line" "$h/.bashrc" 2>/dev/null || grep -qF "$line" "$h/.zshrc" 2>/dev/null; ' +
  'then echo 1; else echo 0; fi';

/**
 * Alias the in-container `claude` to `claude --dangerously-skip-permissions` so
 * interactive terminals opened in code-server don't prompt for permission on every
 * action — instances are throwaway, single-tenant sandboxes. Always applied; it has
 * no host dependency. Only affects interactive shells (which is what code-server opens).
 */
export const claudeSkipPermissions: Injection = {
  id: 'claude-skip-permissions',
  label: 'claude alias',

  async apply(target, log) {
    log('Installing claude --dangerously-skip-permissions alias…\n');
    const res = await execInContainer(target, { script: APPLY_SCRIPT });
    log(
      res.ok
        ? '✓ claude skip-permissions alias installed\n'
        : `⚠ claude alias setup failed: ${res.error}\n`,
    );
  },

  async check(target) {
    return checkPresence(target, CHECK_SCRIPT);
  },
};
