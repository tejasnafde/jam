import { describe, expect, it } from "vitest";
import { autotune, detectPitch, pitchTrack, shiftPitch, snapMidi } from "./pitch";
import { computeStats, encodeWav } from "./wav";

const SR = 48000;
const sine = (hz: number, n: number, sr = SR) =>
  Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sr));

/** Median detected pitch over the middle of a signal. Short frames: grain splices bias long ones. */
function pitchOf(x: Float32Array, sr = SR): number {
  const found: number[] = [];
  for (let at = 4096; at + 1024 < x.length - 4096; at += 512) {
    const hz = detectPitch(x.subarray(at, at + 1024), sr);
    if (hz) found.push(hz);
  }
  return found.sort((a, b) => a - b)[found.length >> 1] ?? 0;
}

describe("detectPitch", () => {
  it.each([82.41, 110, 220, 261.63, 440, 880])("finds %s Hz in a sine", (hz) => {
    const got = detectPitch(sine(hz, 2048), SR);
    expect(got).not.toBeNull();
    expect(Math.abs((got ?? 0) - hz) / hz).toBeLessThan(0.005);
  });

  it("returns null for silence and for noise", () => {
    expect(detectPitch(new Float32Array(2048), SR)).toBeNull();
    let seed = 1;
    const noise = Float32Array.from(
      { length: 2048 },
      () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1,
    );
    expect(detectPitch(noise, SR)).toBeNull();
  });
});

describe("snapMidi", () => {
  it("snaps to the nearest note in the scale", () => {
    expect(snapMidi(60.8, "C", "major")).toBe(60); // to C (D is farther)
    expect(snapMidi(61.6, "C", "major")).toBe(62); // to D
    expect(snapMidi(66, "C", "major")).toBe(65); // F# to F (tie, lower wins)
    expect(snapMidi(66.2, "C", "chromatic")).toBe(66);
    expect(snapMidi(63.4, "A", "minor")).toBe(64); // D# to E in A minor
  });
});

describe("shiftPitch", () => {
  it.each([2, 0.5, 2 ** (1 / 12)])("shifts a 220 Hz sine by ratio %s", (ratio) => {
    const input = sine(220, SR);
    const out = shiftPitch(input, () => ratio, SR, pitchTrack(input, SR));
    expect(Math.abs(pitchOf(out) - 220 * ratio) / (220 * ratio)).toBeLessThan(0.02);
  });

  it.each([0.5, 2])("does not click on a gliding sine at ratio %s", (ratio) => {
    // 150 to 450 Hz in 1 s: the window changes every hop and flips its period count.
    let ph = 0;
    const input = Float32Array.from({ length: SR }, (_, i) => {
      ph += (2 * Math.PI * (150 + (300 * i) / SR)) / SR;
      return 0.5 * Math.sin(ph);
    });
    const out = shiftPitch(input, () => ratio, SR, pitchTrack(input, SR));
    // The fastest clean output (900 Hz at 0.5 amplitude) moves 0.059 per sample.
    let jump = 0;
    for (let i = 1; i < out.length; i++) jump = Math.max(jump, Math.abs((out[i] ?? 0) - (out[i - 1] ?? 0)));
    expect(jump).toBeLessThan(0.07);
  });
});

describe("autotune", () => {
  it("hard mode pulls a flat A (430 Hz) to 440 Hz in C major", () => {
    const out = autotune(sine(430, SR), SR, { key: "C", scale: "major", speed: 1 });
    expect(Math.abs(pitchOf(out) - 440)).toBeLessThan(4);
  });

  it("leaves an in-tune note in tune", () => {
    const out = autotune(sine(261.63, SR), SR, { key: "C", scale: "major", speed: 1 });
    expect(Math.abs(pitchOf(out) - 261.63)).toBeLessThan(3);
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit PCM header and interleaved samples", () => {
    const left = Float32Array.from([0, 1, -1, 0.5]);
    const right = Float32Array.from([2, -2, 0, -0.5]); // clipped to +-1
    const buf = encodeWav([left, right], 44100);
    const v = new DataView(buf);
    const text = (at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4));
    expect(buf.byteLength).toBe(44 + 4 * 2 * 2);
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(16);
    const samples = Array.from({ length: 8 }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, 32767, -32768, -32768, 0, 16383, -16384]);
  });
});

describe("computeStats", () => {
  it("puts a 100 Hz sine in the low band and a 9 kHz sine in the high band", () => {
    const lo = computeStats(sine(100, SR), SR);
    const hi = computeStats(sine(9000, SR), SR);
    expect(lo.low).toBeGreaterThan(0.6);
    expect(hi.high).toBeGreaterThan(0.6);
    expect(lo.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    for (const s of [lo, hi]) expect(s.low + s.mid + s.high).toBeCloseTo(1, 5);
  });
});
