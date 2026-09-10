/**
 * Decodes an OSC 52 clipboard-write payload into the text it carries, or null when there is
 * nothing to copy. The `data` is everything xterm hands the handler after the `52;`.
 */
export function parseOsc52(data: string): string | null {
	const sep = data.indexOf(';');
	if (sep === -1) return null;
	// tmux leaves the selection field empty (`OSC 52 ; ; …`), and a browser has one clipboard
	// anyway, so which selection was named never changes where the text goes.
	const payload = data.slice(sep + 1);
	// `?` asks the terminal to report its clipboard back, which we never answer.
	if (payload === '' || payload === '?') return null;
	try {
		const binary = atob(payload);
		return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
	} catch {
		return null;
	}
}
