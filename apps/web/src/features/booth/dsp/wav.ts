import type { AudioReading } from "@jam/shared";

/** 16-bit PCM WAV, channels interleaved. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * numCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * 2, true);
  v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      const s = Math.max(-1, Math.min(1, ch[i] ?? 0));
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return buf;
}

/**
 * Loudness (RMS) and the share of energy below 250 Hz, between, and above 4 kHz,
 * the same bands as the live audio snapshot. One-pole filters split the bands.
 * ponytail: one-pole slopes are gentle (6 dB/oct), fine for a coarse summary.
 */
export function computeStats(x: Float32Array, sampleRate: number): AudioReading {
  const coef = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  const aLow = coef(250);
  const aHigh = coef(4000);
  let lp1 = 0;
  let lp2 = 0;
  let sum = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  for (const s of x) {
    lp1 += aLow * (s - lp1);
    lp2 += aHigh * (s - lp2);
    const h = s - lp2;
    const m = lp2 - lp1;
    sum += s * s;
    low += lp1 * lp1;
    mid += m * m;
    high += h * h;
  }
  const total = low + mid + high;
  const rms = Math.min(1, Math.sqrt(sum / Math.max(1, x.length)));
  if (total <= 0) return { rms, low: 0, mid: 0, high: 0 };
  return { rms, low: low / total, mid: mid / total, high: high / total };
}
