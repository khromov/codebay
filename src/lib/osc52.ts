/**
 * OSC 52 is how a program inside the container asks the *outer* terminal to put text on the host
 * clipboard — what tmux's `set-clipboard on` emits on copy. xterm.js ships no handler for it, so
 * every such write was silently dropped and copy out of an instance was impossible.
 */
export function decodeOsc52(data: string): string | null {
	const sep = data.indexOf(';');
	if (sep === -1) return null;
	const payload = data.slice(sep + 1).replace(/\s+/g, '');
	// `?` is a read request; answering it would hand the host clipboard to the container.
	if (payload === '' || payload === '?') return null;
	try {
		const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}
