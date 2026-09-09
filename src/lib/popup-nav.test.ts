import { expect, mock, test } from 'bun:test';
import { installPopupBackTrap, onBackLinkClick } from './popup-nav.ts';

test('popup section navigation stays open while Back past the initial entry and Home close it', () => {
	const keys = ['window', 'location', 'history', 'setTimeout'] as const;
	const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
	const close = mock(() => {});
	let listener: ((event: { state: unknown }) => void) | undefined;
	const entries: unknown[] = [{ existing: 'state' }];
	const history = {
		state: entries[0],
		replaceState(state: unknown) {
			entries[entries.length - 1] = this.state = state;
		},
		pushState(state: unknown) {
			entries.push((this.state = state));
		}
	};
	const location = { search: '?popup=1', href: 'http://localhost/settings?popup=1' };
	const values = [
		{
			close,
			addEventListener: (_: string, handler: typeof listener) => (listener = handler),
			removeEventListener: () => (listener = undefined)
		},
		location,
		history,
		mock(() => 0)
	];
	try {
		keys.forEach((key, i) =>
			Object.defineProperty(globalThis, key, { value: values[i], configurable: true })
		);
		const cleanup = installPopupBackTrap();
		expect(entries[1]).toEqual({ existing: 'state' });
		// Native fragment clicks and Back/Forward between fragments can carry null state.
		for (const hash of ['#agents', '#appearance', '#agents', '']) {
			location.href = `http://localhost/settings?popup=1${hash}`;
			listener?.({ state: null });
			listener?.({ state: entries[1] });
		}
		expect(close).not.toHaveBeenCalled();
		listener?.({ state: entries[0] });
		expect(close).toHaveBeenCalledTimes(1);
		const preventDefault = mock(() => {});
		onBackLinkClick({ button: 0, preventDefault } as unknown as MouseEvent);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(2);
		cleanup();
		expect(listener).toBeUndefined();
		location.search = '';
		installPopupBackTrap()();
		expect(entries).toHaveLength(2);
		expect(listener).toBeUndefined();
	} finally {
		keys.forEach((key, i) => {
			const descriptor = originals[i];
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		});
	}
});
