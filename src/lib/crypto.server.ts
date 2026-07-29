/**
 * A plain `===` short-circuits on the first differing byte, leaking length and prefix
 * through timing. Hashing first makes both sides fixed-width, so even the lengths don't leak.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
	const ah = Bun.SHA256.hash(a, 'hex');
	const bh = Bun.SHA256.hash(b, 'hex');
	// No early exit — the loop must run its full length on every call.
	let diff = ah.length ^ bh.length;
	for (let i = 0; i < ah.length; i++) diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
	return diff === 0;
}
