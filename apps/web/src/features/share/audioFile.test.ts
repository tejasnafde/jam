import { SHARE_LIMITS } from "@jam/shared";
import { describe, expect, it } from "vitest";
import { assemble } from "./capture";
import { computePeaks } from "./peaks";
import { planWav, resample, shareWav } from "./wavFile";

describe("planWav", () => {
  const MB = 1024 * 1024;

  it("keeps stereo at the recorded rate when it fits", () => {
    // 0:40 at 48 kHz stereo is about 7.3 MB.
    expect(planWav(40 * 48_000, 48_000)).toMatchObject({ channels: 2, sampleRate: 48_000 });
  });

  it("drops to mono for a long piece, and to a lower rate only when mono is too large", () => {
    expect(planWav(200 * 48_000, 48_000)).toMatchObject({ channels: 1, sampleRate: 48_000 });
    // 4:02 at 96 kHz: mono is 46 MB, so the rate comes down.
    const plan = planWav(242 * 96_000, 96_000);
    expect(plan.channels).toBe(1);
    expect(plan.sampleRate).toBeLessThan(96_000);
    expect(plan.bytes).toBeLessThanOrEqual(SHARE_LIMITS.targetBytes);
  });

  it("stays under the server limit for the longest share at 48 kHz", () => {
    const frames = (SHARE_LIMITS.maxSeconds + SHARE_LIMITS.tailSeconds) * 48_000;
    expect(planWav(frames, 48_000).bytes).toBeLessThan(SHARE_LIMITS.maxBytes);
    expect(planWav(frames, 48_000).bytes).toBeLessThan(25 * MB);
  });
});

describe("shareWav", () => {
  it("writes a 16-bit stereo WAV header", async () => {
    const l = new Float32Array([0, 0.5, -0.5, 1]);
    const blob = shareWav([l, l], 48_000);
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe("audio/wav");
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(view.getInt16(44 + 4, true)).toBe(Math.trunc(0.5 * 0x7fff)); // left, frame 1
    expect(view.getInt16(44 + 6, true)).toBe(Math.trunc(0.5 * 0x7fff)); // right, frame 1
  });
});

describe("resample", () => {
  it("halves the length at half the rate and keeps a ramp a ramp", () => {
    const x = Float32Array.from({ length: 8 }, (_, i) => i);
    expect(Array.from(resample(x, 48_000, 24_000))).toEqual([0, 2, 4, 6]);
  });
});

describe("assemble", () => {
  it("lines blocks up from cycle 0 and leaves gaps silent", () => {
    const block = (frame: number, values: number[]) => ({
      frame,
      l: Float32Array.from(values),
      r: Float32Array.from(values.map((v) => -v)),
    });
    const [l, r] = assemble([block(0, [1, 1, 1, 1]), block(6, [2, 2, 2, 2])], 2, 8);
    expect(Array.from(l)).toEqual([1, 1, 0, 0, 2, 2, 2, 2]);
    expect(Array.from(r)).toEqual([-1, -1, 0, 0, -2, -2, -2, -2]);
  });
});

describe("computePeaks", () => {
  it("takes the loudest sample per slice and scales to 1", () => {
    const ch = Float32Array.from([0.1, -0.2, 0.05, 0.4, 0, 0]);
    expect(computePeaks([ch], 3)).toEqual([0.5, 1, 0]);
  });

  it("returns zeros for silence", () => {
    expect(computePeaks([new Float32Array(10)], 4)).toEqual([0, 0, 0, 0]);
  });
});
