#!/usr/bin/env bun
/**
 * Renders the attention chimes to WAV files under `public/sounds/`.
 *
 * Each chime is a short pair of sine notes with a quick attack and exponential
 * decay — the same synthesis the UI used to do live via the Web Audio API. This
 * script bakes them into static files so the client just plays a URL, and new
 * chimes can be added by extending `CHIMES` and rerunning `bun run gen:chimes`.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Synthesis recipes — the single source of truth for what each chime sounds like. */
const CHIMES: Record<string, { notes: number[] }> = {
	done: { notes: [660, 988] }, // bright ascending pair
	waiting: { notes: [523, 415] } // lower, more insistent
};

const SAMPLE_RATE = 44100;
const NOTE_SPACING = 0.13; // seconds between note onsets
const PEAK_GAIN = 0.18; // matches the old Web Audio envelope peak
const ATTACK = 0.02; // linear ramp up to peak
const DECAY_END = 0.28; // exponential decay reaches ~silence here (relative to onset)
const NOTE_LEN = 0.3; // each note fully stops here (relative to onset)
const FLOOR = 0.0001; // exponential ramp target (can't be 0)

const OUT_DIR = join(dirname(import.meta.dir), 'public', 'sounds');

/** Render one chime recipe to a mono float sample buffer in [-1, 1]. */
function renderChime(notes: number[]): Float32Array {
	const totalSeconds = (notes.length - 1) * NOTE_SPACING + NOTE_LEN;
	const frames = Math.ceil(totalSeconds * SAMPLE_RATE);
	const out = new Float32Array(frames);

	notes.forEach((freq, i) => {
		const onset = i * NOTE_SPACING;
		const startFrame = Math.floor(onset * SAMPLE_RATE);
		const endFrame = Math.min(frames, Math.floor((onset + NOTE_LEN) * SAMPLE_RATE));
		for (let f = startFrame; f < endFrame; f++) {
			const t = (f - startFrame) / SAMPLE_RATE; // seconds since this note's onset
			out[f] += Math.sin(2 * Math.PI * freq * t) * envelope(t);
		}
	});

	// Guard against summed notes clipping past full scale.
	let peak = 0;
	for (const s of out) peak = Math.max(peak, Math.abs(s));
	if (peak > 1) for (let f = 0; f < out.length; f++) out[f] /= peak;

	return out;
}

/** Gain envelope for a single note: linear attack, exponential decay (Web Audio parity). */
function envelope(t: number): number {
	if (t < ATTACK) return (t / ATTACK) * PEAK_GAIN;
	if (t >= DECAY_END) return 0;
	// exponentialRampToValueAtTime from PEAK_GAIN (at ATTACK) to FLOOR (at DECAY_END).
	const span = DECAY_END - ATTACK;
	const progress = (t - ATTACK) / span;
	return PEAK_GAIN * Math.pow(FLOOR / PEAK_GAIN, progress);
}

/** Wrap mono float samples in a 16-bit PCM WAV (RIFF) container. */
function encodeWav(samples: Float32Array): Uint8Array {
	const bytesPerSample = 2;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const writeStr = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
	};

	writeStr(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true); // file size minus first 8 bytes
	writeStr(8, 'WAVE');
	writeStr(12, 'fmt ');
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * bytesPerSample, true); // byte rate
	view.setUint16(32, bytesPerSample, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeStr(36, 'data');
	view.setUint32(40, dataSize, true);

	let offset = 44;
	for (const s of samples) {
		const clamped = Math.max(-1, Math.min(1, s));
		view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
		offset += bytesPerSample;
	}

	return new Uint8Array(buffer);
}

await mkdir(OUT_DIR, { recursive: true });

for (const [name, { notes }] of Object.entries(CHIMES)) {
	const wav = encodeWav(renderChime(notes));
	const path = join(OUT_DIR, `${name}.wav`);
	await Bun.write(path, wav);
	console.log(`✓ ${path} (${(wav.length / 1024).toFixed(1)} KB)`);
}
