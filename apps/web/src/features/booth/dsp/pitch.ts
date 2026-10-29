// Pitch detection (YIN) and a pitch shifter for offline vocal processing.

/**
 * YIN pitch detection (de Cheveigne and Kawahara, 2002).
 * Returns the fundamental in Hz, or null for a silent or unvoiced frame.
 */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  { minHz = 70, maxHz = 1000, threshold = 0.15 } = {},
): number | null {
  const half = Math.floor(frame.length / 2);
  const tauMax = Math.min(half - 1, Math.floor(sampleRate / minHz));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));

  let energy = 0;
  for (const x of frame) energy += x * x;
  if (energy / frame.length < 1e-6) return null;

  // Cumulative mean normalized difference function.
  const d = new Float32Array(tauMax + 1);
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const diff = (frame[i] ?? 0) - (frame[i + tau] ?? 0);
      sum += diff * diff;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  for (let tau = tauMin; tau <= tauMax; tau++) {
    if ((d[tau] ?? 0) >= threshold) continue;
    while (tau + 1 <= tauMax && (d[tau + 1] ?? 0) < (d[tau] ?? 0)) tau++;
    // Parabolic interpolation around the minimum.
    const a = d[tau - 1] ?? 0;
    const b = d[tau] ?? 0;
    const c = tau + 1 <= tauMax ? (d[tau + 1] ?? 0) : b;
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    return sampleRate / (tau + shift);
  }
  return null;
}

export const HOP = 512;

/** Pitch per HOP samples in Hz, 0 where unvoiced. Analysed at half rate: 4x cheaper, voices stay far below Nyquist. */
export function pitchTrack(input: Float32Array, sampleRate: number): Float32Array {
  const dec = new Float32Array(Math.floor(input.length / 2));
  for (let i = 0; i < dec.length; i++) dec[i] = ((input[2 * i] ?? 0) + (input[2 * i + 1] ?? 0)) / 2;
  const frame = 1024;
  const track = new Float32Array(Math.ceil(input.length / HOP));
  for (let h = 0; h < track.length; h++) {
    const start = Math.max(0, Math.min(dec.length - frame, Math.floor((h * HOP) / 2) - frame / 2));
    track[h] = detectPitch(dec.subarray(start, start + frame), sampleRate / 2) ?? 0;
  }
  return track;
}

/**
 * Pitch shift with a time-varying ratio (output Hz / input Hz).
 * Two read taps sweep a delay window of about 30 ms, half a window apart,
 * and crossfade with sin^2 gains that always sum to 1. With a pitch track,
 * the window is a whole number of periods, so both taps stay in phase and
 * the splices do not detune the voice. The window is centered, so the output
 * has no added latency (offline only: it reads ahead).
 * Each tap moves its own read offset smoothly and jumps by a window only at
 * its zero gain, so a window change never moves an audible tap (no clicks).
 * ponytail: delay-line granular shifter, not full PSOLA (no formant care).
 */
export function shiftPitch(
  input: Float32Array,
  ratioAt: (i: number) => number,
  sampleRate: number,
  track?: Float32Array,
): Float32Array {
  const base = sampleRate * 0.03;
  const out = new Float32Array(input.length);
  const at = (pos: number) => {
    const i = Math.floor(pos);
    if (i < 0 || i + 1 >= input.length) return 0;
    const f = pos - i;
    return (input[i] ?? 0) * (1 - f) + (input[i + 1] ?? 0) * f;
  };
  const windowAt = (i: number) => {
    const hz = track?.[Math.floor(i / HOP)] ?? 0;
    const period = hz > 0 ? sampleRate / hz : 0;
    return period > 0 ? 2 * period * Math.max(1, Math.round(base / (2 * period))) : base;
  };
  // Per tap: the phase sets its gain, the offset (read position minus i) where it reads.
  const w0 = windowAt(0);
  const taps = [0, 0.5].map((phase) => ({ phase, offset: w0 * (0.5 - phase) }));
  for (let i = 0; i < input.length; i++) {
    const win = windowAt(i);
    const ratio = ratioAt(i);
    for (const t of taps) {
      t.phase += (1 - ratio) / win;
      t.offset += ratio - 1;
      if (t.phase >= 1 || t.phase < 0) {
        t.phase -= Math.floor(t.phase);
        t.offset = win * (0.5 - t.phase); // gain is zero here, so the jump is silent
      }
    }
    const [a, b] = taps as [(typeof taps)[0], (typeof taps)[0]];
    const g = Math.sin(Math.PI * a.phase) ** 2;
    out[i] = g * at(i + a.offset) + (1 - g) * at(i + b.offset);
  }
  return out;
}

export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type Key = (typeof KEYS)[number];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "major pentatonic": [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;
export type Scale = keyof typeof SCALES;

/** The nearest MIDI note (integer) in the key and scale. */
export function snapMidi(midi: number, key: Key, scale: Scale): number {
  const root = KEYS.indexOf(key);
  const base = Math.round(midi);
  let best = base;
  let bestDist = Infinity;
  for (let n = base - 6; n <= base + 6; n++) {
    const pc = (((n - root) % 12) + 12) % 12;
    if (!(SCALES[scale] as readonly number[]).includes(pc)) continue;
    const dist = Math.abs(n - midi);
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

export interface TuneOptions {
  key: Key;
  scale: Scale;
  /** 0 = natural (slow glide), 1 = hard (instant snap). */
  speed: number;
}

/** Pitch correction curve in semitones per hop: snap the detected pitch to the scale and glide there at the retune speed. */
export function tuneCurve(track: Float32Array, sampleRate: number, { key, scale, speed }: TuneOptions): Float32Array {
  const tc = 0.001 + (1 - speed) ** 2 * 0.3; // seconds
  const alpha = 1 - Math.exp(-HOP / sampleRate / tc);
  const shift = new Float32Array(track.length);
  let cur = 0;
  track.forEach((hz, h) => {
    let want = 0;
    if (hz > 0) {
      const midi = 69 + 12 * Math.log2(hz / 440);
      want = snapMidi(midi, key, scale) - midi;
    }
    cur += (want - cur) * alpha;
    shift[h] = cur;
  });
  return shift;
}

/** Pitch correction of `input`, whose pitch track is `track`. */
export function autotune(
  input: Float32Array,
  sampleRate: number,
  opts: TuneOptions,
  track = pitchTrack(input, sampleRate),
): Float32Array {
  const shift = tuneCurve(track, sampleRate, opts);
  return shiftPitch(input, (i) => 2 ** ((shift[Math.floor(i / HOP)] ?? 0) / 12), sampleRate, track);
}
