import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundItem } from "./catalog";
import { PREVIEW_LEAD, previewSound } from "./strudelSounds";

const bd: SoundItem = { kind: "drum", name: "bd", key: "rolandtr909_bd", machine: "RolandTR909" };

/**
 * A stand-in for Strudel's superdough and AudioContext. Like the real sampler, the first hit of a sound
 * waits for the fetch (the clock moves on), and a hit that ends past its time makes no sound.
 */
function fakeStrudel(fetchSeconds: number) {
  const ac = { currentTime: 10, state: "running", resume: vi.fn() };
  const loaded = new Set<string>();
  const heard: number[] = [];
  const calls: { value: Record<string, unknown>; ref: object; t: number }[] = [];
  const superdough = vi.fn(async (value: Record<string, unknown>, t: number) => {
    calls.push({ value: { ...value }, ref: value, t });
    const key = String(value.s);
    // The real superdough writes into the value it gets, so a reused object would carry old fields.
    value.s = "changed by superdough";
    if (!loaded.has(key)) {
      await Promise.resolve();
      ac.currentTime += fetchSeconds;
      loaded.add(key);
    }
    if (ac.currentTime > t) return;
    heard.push(t);
  });
  Object.assign(globalThis, { superdough, getAudioContext: () => ac });
  return { ac, heard, calls };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.superdough;
  delete g.getAudioContext;
});

describe("previewSound", () => {
  it("returns false before Strudel loads", async () => {
    expect(await previewSound(bd)).toBe(false);
  });

  it("plays the first click of an unloaded sound once the fetch ends", async () => {
    const { heard, calls } = fakeStrudel(0.3);
    expect(await previewSound(bd)).toBe(true);
    expect(heard).toHaveLength(1);
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(second?.ref).not.toBe(first?.ref);
    expect(second?.value).toMatchObject({ s: "rolandtr909_bd", release: 0.05 });
    expect(second?.t).toBeCloseTo(10.3 + PREVIEW_LEAD);
  });

  it("plays a loaded sound once, with no second hit", async () => {
    const { heard, calls } = fakeStrudel(0.3);
    await previewSound(bd);
    await previewSound(bd);
    expect(heard).toHaveLength(2);
    expect(calls).toHaveLength(3);
  });

  it("does not hit twice when the fetch ends in time", async () => {
    const { heard, calls } = fakeStrudel(0.01);
    await previewSound(bd);
    expect(heard).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
