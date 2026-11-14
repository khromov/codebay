/**
 * Windows has no single filesystem root: `dirname('C:\')` is `C:\`, so walking up from the home
 * directory dead-ends on its own drive and a project on another one is unreachable. This stands in
 * as the parent of every drive root, and browsing it lists the drives themselves.
 *
 * A colon is illegal in a Windows path segment, so this can never collide with a real folder.
 */
export const DRIVES_ROOT = '::drives';

/** What the crumbs show for the virtual root, which has no path of its own. */
export const DRIVES_ROOT_LABEL = 'This PC';
