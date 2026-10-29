import { describe, expect, it } from "vitest";
import { DRY, opsFor, preset, tailSeconds } from "./effects";

describe("presets and ops", () => {
  it("presets keep the chosen key and scale", () => {
    const current = { ...DRY, autotune: { ...DRY.autotune, key: "F#" as const, scale: "minor" as const } };
    const hard = preset("hard tune", current);
    expect(hard.autotune).toMatchObject({ on: true, key: "F#", scale: "minor", speed: 1 });
    expect(preset("dry", hard)).toEqual({ ...DRY, autotune: { ...DRY.autotune, key: "F#", scale: "minor" } });
  });

  it("lists only the effects that are on", () => {
    expect(opsFor(DRY, 120)).toEqual([]);
    expect(opsFor(preset("dark double", DRY), 90)).toEqual([
      "autotune:natural:C major",
      "octave:-12",
      "lowpass:2500",
      "distortion:0.15",
      "reverb:2.5s",
    ]);
    expect(opsFor(preset("far away", DRY), 100)).toContain("delay:1/4@100bpm");
  });

  it("adds the reverb tail to the delay tail", () => {
    // far away at 120 bpm: echoes every 0.5 s at feedback 0.4 (5 repeats), then 4 s of reverb.
    const tail = tailSeconds(preset("far away", DRY), 120);
    expect(tail).toBeGreaterThan(6.5);
    expect(tail).toBeLessThan(7);
  });
});
