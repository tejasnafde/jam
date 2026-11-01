import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scheduler } from "@/features/editor/strudelTypes";
import { CaptureCancelled, capturePass, HIDDEN_TAB_MESSAGE, untilCycle, type HapLike } from "./capture";

// A fake Strudel context: its clock follows the fake timers.
let startMs = 0;
const ctx = {
  state: "running",
  sampleRate: 1000,
  get currentTime() {
    return (Date.now() - startMs) / 1000;
  },
  destination: {},
  audioWorklet: { addModule: vi.fn(async () => {}) },
  createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
  resume: vi.fn(async () => {}),
};
const tap = { connect: vi.fn(), disconnect: vi.fn() };

vi.mock("@/lib/audio", () => ({
  musicTap: () => ({ ctx, tap }),
  connectUntapped: vi.fn(),
}));

class FakeWorkletNode {
  port = { onmessage: null as ((e: MessageEvent) => void) | null, postMessage: vi.fn() };
  disconnect = vi.fn();
}

/** A pattern whose haps start at these cycles. filterHaps keeps the test, so a query can run it. */
class FakePattern {
  constructor(
    readonly begins: number[],
    readonly test: (hap: HapLike) => boolean = () => true,
  ) {}
  filterHaps(test: (hap: HapLike) => boolean) {
    return new FakePattern(this.begins, (h) => this.test(h) && test(h));
  }
  /** The cycles that would sound. */
  onsets() {
    return this.begins.filter((b) => this.test({ whole: { begin: b }, part: { begin: b } }));
  }
}

function fakeScheduler(pattern: FakePattern, playing: boolean) {
  const events: { at: number; what: "start" | "stop"; pattern: unknown }[] = [];
  const scheduler: Scheduler = {
    cps: 1,
    latency: 0.1,
    pattern,
    started: playing,
    start() {
      scheduler.started = true;
      scheduler.seconds_at_cps_change = ctx.currentTime;
      scheduler.num_ticks_since_cps_change = 1;
      events.push({ at: ctx.currentTime, what: "start", pattern: scheduler.pattern });
    },
    stop() {
      scheduler.started = false;
      events.push({ at: ctx.currentTime, what: "stop", pattern: scheduler.pattern });
    },
  };
  return { scheduler, events };
}

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  startMs = Date.now();
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  URL.createObjectURL = vi.fn(() => "blob:worklet");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("untilCycle", () => {
  it("drops every hap that starts at or after the last bar, so the tail has no next downbeat", () => {
    const cut = untilCycle(new FakePattern([0, 1, 2.5, 3.99, 4, 4.5, 8]), 4) as FakePattern;
    expect(cut.onsets()).toEqual([0, 1, 2.5, 3.99]);
  });

  it("uses the part for a hap with no whole", () => {
    const pattern = { filterHaps: vi.fn((test: (h: HapLike) => boolean) => test) };
    const test = untilCycle(pattern, 2) as (h: HapLike) => boolean;
    expect(test({ whole: null, part: { begin: 1.5 } })).toBe(true);
    expect(test({ whole: null, part: { begin: 2 } })).toBe(false);
  });
});

describe("capturePass", () => {
  const length = { cycles: 4, seconds: 4, tailSeconds: 2 };

  it("records the cut pattern, stops on time with no margin, then restores the pattern and playback", async () => {
    const original = new FakePattern([0, 1, 2, 3, 4, 5]);
    const { scheduler, events } = fakeScheduler(original, true);
    const done = capturePass(scheduler, length, () => {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(7000);
    const recording = await done;

    expect(recording.channels[0]).toHaveLength(6 * 1000);
    const recordStart = events.find((e) => e.what === "start");
    // The pass plays a copy with no hap from bar 5 on.
    expect(recordStart?.pattern).not.toBe(original);
    expect((recordStart?.pattern as FakePattern).onsets()).toEqual([0, 1, 2, 3]);
    // The scheduler stops at the end of bar 4, not 0.2 s early.
    const stopAfter = events.find((e) => e.what === "stop" && e.at > (recordStart?.at ?? 0));
    expect(stopAfter?.at).toBeGreaterThanOrEqual((recordStart?.at ?? 0) + 0.1 + length.seconds);
    // The user's pattern is back, and the music plays again because it played before.
    expect(scheduler.pattern).toBe(original);
    expect(scheduler.started).toBe(true);
    expect(events.at(-1)?.what).toBe("start");
    expect(events.at(-1)?.pattern).toBe(original);
  });

  it("leaves the music off when it was off", async () => {
    const original = new FakePattern([0]);
    const { scheduler } = fakeScheduler(original, false);
    const done = capturePass(scheduler, length, () => {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(7000);
    await done;
    expect(scheduler.started).toBe(false);
    expect(scheduler.pattern).toBe(original);
  });

  it("fails when the tab is hidden, and restores the pattern", async () => {
    const original = new FakePattern([0]);
    const { scheduler } = fakeScheduler(original, true);
    const done = capturePass(scheduler, length, () => {}, new AbortController().signal);
    const failed = expect(done).rejects.toThrow(HIDDEN_TAB_MESSAGE);
    await vi.advanceTimersByTimeAsync(1000);
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(200);
    await failed;
    expect(scheduler.pattern).toBe(original);
    expect(scheduler.started).toBe(true);
  });

  it("stops on cancel and restores the pattern", async () => {
    const original = new FakePattern([0]);
    const { scheduler } = fakeScheduler(original, false);
    const controller = new AbortController();
    const done = capturePass(scheduler, length, () => {}, controller.signal);
    const cancelled = expect(done).rejects.toBeInstanceOf(CaptureCancelled);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(200);
    await cancelled;
    expect(scheduler.pattern).toBe(original);
    expect(scheduler.started).toBe(false);
  });
});
