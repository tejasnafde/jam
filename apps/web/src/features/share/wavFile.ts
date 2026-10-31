import { SHARE_LIMITS } from "@jam/shared";
import { encodeWav } from "@/features/booth/dsp/wav";

const wavBytes = (frames: number, channels: number) => 44 + frames * channels * 2;

/** Linear resampling. Good enough for a share that would not fit at full rate. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const out = new Float32Array(Math.floor((x.length * to) / from));
  const step = from / to;
  for (let i = 0; i < out.length; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = (x[j] ?? 0) * (1 - frac) + (x[j + 1] ?? x[j] ?? 0) * frac;
  }
  return out;
}

export interface WavPlan {
  channels: 1 | 2;
  sampleRate: number;
  bytes: number;
}

/** Stereo at the recorded rate when it fits the target, else mono, else mono at a lower rate. */
export function planWav(frames: number, sampleRate: number, target: number = SHARE_LIMITS.targetBytes): WavPlan {
  if (wavBytes(frames, 2) <= target) return { channels: 2, sampleRate, bytes: wavBytes(frames, 2) };
  if (wavBytes(frames, 1) <= target) return { channels: 1, sampleRate, bytes: wavBytes(frames, 1) };
  for (const rate of [44_100, 32_000, 22_050]) {
    if (rate >= sampleRate) continue;
    const n = Math.floor((frames * rate) / sampleRate);
    if (wavBytes(n, 1) <= target) return { channels: 1, sampleRate: rate, bytes: wavBytes(n, 1) };
  }
  const rate = 16_000;
  return { channels: 1, sampleRate: rate, bytes: wavBytes(Math.floor((frames * rate) / sampleRate), 1) };
}

/** A 16-bit WAV of the recording, under the share size target. */
export function shareWav(channels: [Float32Array, Float32Array], sampleRate: number): Blob {
  const [left, right] = channels;
  const plan = planWav(left.length, sampleRate);
  if (plan.channels === 2) return new Blob([encodeWav([left, right], sampleRate)], { type: "audio/wav" });
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = ((left[i] ?? 0) + (right[i] ?? 0)) / 2;
  return new Blob([encodeWav([resample(mono, sampleRate, plan.sampleRate)], plan.sampleRate)], { type: "audio/wav" });
}
