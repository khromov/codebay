/**
 * Constant-time string comparison for secrets (passwords, tokens). A plain `===`
 * short-circuits on the first differing byte, leaking length/prefix information
 * through timing; this hashes both inputs to a fixed-width hex digest first (so
 * the raw lengths don't matter and the strings are always equal length) and then
 * compares the digests character-by-character with no early exit, so the
 * comparison time is independent of where — or whether — the inputs differ.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
	const ah = Bun.SHA256.hash(a, 'hex');
	const bh = Bun.SHA256.hash(b, 'hex');
	// Both digests are 64 hex chars; the loop runs the full length every time.
	let diff = ah.length ^ bh.length;
	for (let i = 0; i < ah.length; i++) diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
	return diff === 0;
}
