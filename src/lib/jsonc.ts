/** Strip // and /* *\/ comments and trailing commas from JSONC, respecting string literals. */
export function stripJsonc(input: string): string {
	let out = '';
	let inString = false;
	let inLine = false;
	let inBlock = false;
	// Tracked inline rather than by regex, so commas inside string values are never touched.
	let lastComma = -1;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		const next = input[i + 1];
		if (inLine) {
			if (ch === '\n') {
				inLine = false;
				out += ch;
			}
			continue;
		}
		if (inBlock) {
			if (ch === '*' && next === '/') {
				inBlock = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === '\\') {
				out += next ?? '';
				i++;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			lastComma = -1;
			continue;
		}
		if (ch === '/' && next === '/') {
			inLine = true;
			i++;
			continue;
		}
		if (ch === '/' && next === '*') {
			inBlock = true;
			i++;
			continue;
		}
		if (ch === ',') {
			out += ch;
			lastComma = out.length - 1;
			continue;
		}
		if (ch === '}' || ch === ']') {
			if (lastComma !== -1) {
				out = out.slice(0, lastComma) + out.slice(lastComma + 1);
				lastComma = -1;
			}
			out += ch;
			continue;
		}
		out += ch;
		// Whitespace and stripped comments must not clear the pending comma, but real tokens do.
		if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') lastComma = -1;
	}
	return out;
}
