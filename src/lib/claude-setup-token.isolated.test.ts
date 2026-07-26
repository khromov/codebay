import { describe, expect, test } from 'bun:test';
import {
	awaitingCode,
	findAuthorizeUrl,
	findCliError,
	findToken,
	stripAnsi
} from './claude-setup-token.server.ts';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** A line as the Ink-rendered CLI writes it: colour codes around real text. */
const painted = (text: string) => `${ESC}[36m${text}${ESC}[39m`;
/** How Ink actually lays out prose in a terminal: cursor moves instead of spaces. */
const positioned = (...words: string[]) => words.join(`${ESC}[3C`);

const AUTHORIZE_URL =
	'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e' +
	'&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback' +
	'&scope=user%3Ainference&code_challenge=crENpTD75KJMl94Fh_cB-ttrCb5CuZs93bI4uh1Q5ho' +
	'&code_challenge_method=S256&state=RB5feRM0D3Eu6NgwDdeCyTEE20p0nNb7j24d1sDs_UM';

const TOKEN = `sk-ant-oat01-${'a1B2c3D4e5'.repeat(6)}`;

describe('stripAnsi', () => {
	test('drops colour codes, cursor moves and OSC sequences', () => {
		const raw = `${ESC}]0;title${BEL}${ESC}[2J${ESC}[1;1H${painted('Opening browser')}`;
		expect(stripAnsi(raw)).toBe('Opening browser');
	});

	test('keeps the line structure', () => {
		expect(stripAnsi(`${painted('one')}\r\n${painted('two')}`)).toBe('one\r\ntwo');
	});
});

describe('awaitingCode', () => {
	test('recognizes the prompt through Ink cursor-positioned layout', () => {
		// The spaces are cursor moves, so stripping escapes leaves "Pastecodehere…".
		const screen = positioned('Paste', 'code', 'here', 'if', 'prompted', '>');
		expect(stripAnsi(screen)).not.toContain('Paste code here');
		expect(awaitingCode(screen)).toBe(true);
	});

	test('recognizes the prompt when written with real spaces', () => {
		expect(awaitingCode('Paste code here if prompted > ')).toBe(true);
	});

	test('stays false while the CLI is still opening the browser', () => {
		expect(awaitingCode(positioned('Opening', 'browser', 'to', 'sign', 'in…'))).toBe(false);
	});
});

describe('findCliError', () => {
	test('catches the rejected-code screen, which the CLI does not exit on', () => {
		// Verbatim from the CLI after a bad code; it then parks on "Press Enter to
		// retry", so nothing else would end the wait.
		const screen = 'OAuth error: Request failed with status code 400Press Enter to retry.';
		expect(findCliError(screen)).toContain('rejected');
	});

	test('catches it through cursor-positioned layout too', () => {
		expect(findCliError(positioned('OAuth', 'error:', 'Request', 'failed'))).toContain('rejected');
	});

	test('says nothing on a healthy sign-in screen', () => {
		expect(findCliError(positioned('Opening', 'browser', 'to', 'sign', 'in…'))).toBeNull();
	});
});

describe('findAuthorizeUrl', () => {
	test('reads the sign-in URL off a painted line', () => {
		const out = `Browser didn't open?\n\n${painted(AUTHORIZE_URL)}\n\nPaste code here`;
		expect(findAuthorizeUrl(out)).toBe(AUTHORIZE_URL);
	});

	test('reads it when wrapped in an OSC-8 hyperlink', () => {
		const linked = `${ESC}]8;id=1ruqt03;${AUTHORIZE_URL}${BEL}${AUTHORIZE_URL}${ESC}]8;;${BEL}`;
		expect(findAuthorizeUrl(linked)).toBe(AUTHORIZE_URL);
	});

	test('rejects a URL the terminal wrapped, rather than returning half of one', () => {
		const split = `${AUTHORIZE_URL.slice(0, 200)}\n${AUTHORIZE_URL.slice(200)}`;
		expect(findAuthorizeUrl(split)).toBeNull();
	});

	test('ignores an unrelated URL', () => {
		expect(findAuthorizeUrl('see https://code.claude.com/docs/en/overview for help')).toBeNull();
	});

	test('returns null before the CLI has printed anything', () => {
		expect(findAuthorizeUrl('')).toBeNull();
	});
});

describe('findToken', () => {
	test('finds the token once something follows it', () => {
		expect(findToken(`Login successful.\n${painted(TOKEN)}\n`, false)).toBe(TOKEN);
	});

	test('an escape sequence ends the token instead of gluing on the next word', () => {
		// Stripping escapes first would run "Press" into the token and save a longer,
		// wrong secret — the reason the match is made against the raw stream.
		expect(findToken(`${TOKEN}${ESC}[3CPress enter`, false)).toBe(TOKEN);
	});

	test('waits rather than returning a token still being written', () => {
		// The PTY read ended mid-token; matching now would save a truncated secret.
		expect(findToken(`Login successful.\n${TOKEN.slice(0, 40)}`, false)).toBeNull();
	});

	test('accepts a token that ends the buffer once the process has exited', () => {
		expect(findToken(`Login successful.\n${TOKEN}`, true)).toBe(TOKEN);
	});

	test('prefers the last token when the screen was redrawn', () => {
		const stale = `sk-ant-oat01-${'z9Y8x7W6v5'.repeat(6)}`;
		expect(findToken(`${stale}\n${ESC}[2J${TOKEN}\n`, false)).toBe(TOKEN);
	});

	test('returns null while the CLI is still on the sign-in screen', () => {
		expect(
			findToken('Opening browser to sign in…\nPaste code here if prompted > ', false)
		).toBeNull();
	});
});
