// Drawing modes for the avatar editor: how a click advances a cell's value.
import { ON, OFF, GRAY } from './types.ts';

export type Mode = 'black' | 'gray' | 'cycle';

export const MODES: { id: Mode; label: string }[] = [
	{ id: 'black', label: 'Black' },
	{ id: 'gray', label: 'Gray' },
	{ id: 'cycle', label: 'Cycle' }
];

// black toggles off↔on, gray toggles off↔gray, cycle steps off→gray→on→off.
export function nextValue(mode: Mode, current: number): number {
	if (mode === 'black') return current === ON ? OFF : ON;
	if (mode === 'gray') return current === GRAY ? OFF : GRAY;
	return current === OFF ? GRAY : current === GRAY ? ON : OFF;
}
