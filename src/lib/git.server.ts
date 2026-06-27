import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Read the branch currently checked out in an instance's workspace by parsing
 * `.git/HEAD`. The workspace copy is bind-mounted into the container, so the host
 * file tracks the live branch inside the running container — reading it here is a
 * cheap poll that needs no `docker exec`. Returns the branch name, a short SHA when
 * HEAD is detached, or null when there is no readable git repo.
 */
export async function readGitBranch(workspacePath: string): Promise<string | null> {
  try {
    const head = (await readFile(join(workspacePath, '.git', 'HEAD'), 'utf8')).trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (ref) return ref[1] ?? null;
    // Detached HEAD: the file holds a raw commit SHA instead of a ref.
    return head ? head.slice(0, 7) : null;
  } catch {
    return null;
  }
}
