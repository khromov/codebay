/** Digit jumps follow the browser convention: 1–8 are absolute, 9 is always the last tab. */
function digitTarget(digit: number, count: number): number {
	return digit === 9 ? count - 1 : digit - 1;
}

/**
 * Index the tab strip should move to for a key, or `null` to leave the event alone.
 * Pure so the arrow/Home/End/digit math is testable without a DOM.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
	if (count <= 0) return null;
	// A `current` outside the strip (nothing focused yet) still resolves, since the
	// arrow branches below normalise through a modulo of `count`.
	const from = current < 0 || current >= count ? 0 : current;
	switch (key) {
		case 'ArrowRight':
			return (from + 1) % count;
		case 'ArrowLeft':
			return (from - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default: {
			if (!/^[1-9]$/.test(key)) return null;
			const target = digitTarget(Number(key), count);
			return target < count ? target : null;
		}
	}
}
