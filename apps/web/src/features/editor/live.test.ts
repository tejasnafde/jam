import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_DEBOUNCE_MS, LIVE_VERSION_MS, LiveController, serial, VersionCoalescer } from "./live";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const evaluate = vi.fn<(code: string) => void>();
  const revert = vi.fn<(code: string) => void>();
  const live = new LiveController({ evaluate, revert });
  return { live, evaluate, revert };
}
const on = { enabled: true, playing: true };

describe("Live mode", () => {
  it("evaluates once the user pauses typing", () => {
    const { live, evaluate } = setup();
    live.onEdit("a", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS - 100);
    live.onEdit("ab", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS - 100);
    expect(evaluate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith("ab");
    expect(live.evaluatingLive).toBe(true);
  });

  it("does nothing when off or when nothing plays", () => {
    const { live, evaluate } = setup();
    live.onEdit("a", { enabled: false, playing: true });
    live.onEdit("b", { enabled: true, playing: false });
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("skips code that did not change since the last evaluation", () => {
    const { live, evaluate } = setup();
    live.onEvaluated("same"); // a Ctrl+Enter
    live.onEdit("same", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(evaluate).not.toHaveBeenCalled();
    // Code that failed is not tried again either.
    live.onEdit("bad(", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    live.onEvalError("bad(");
    live.onEdit("bad(", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith("bad(");
  });

  it("puts the last good pattern back when a Live pattern fails at run time", () => {
    const { live, evaluate, revert } = setup();
    live.onEvaluated("good");
    live.onEdit("broken", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(evaluate).toHaveBeenCalledWith("broken");
    live.onEvaluated("broken"); // it parsed; the scheduler then fails on it
    expect(live.onSchedulerError("broken")).toBe(true);
    expect(revert).toHaveBeenCalledExactlyOnceWith("good");
    // Only once, and the broken code is not tried again until the user edits.
    expect(live.onSchedulerError("broken")).toBe(false);
    live.onEdit("broken", on);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("leaves a runtime error from Ctrl+Enter alone", () => {
    const { live, revert } = setup();
    live.onEvaluated("good");
    live.onEvaluated("broken"); // Ctrl+Enter: the user's own choice
    expect(live.onSchedulerError("broken")).toBe(false);
    expect(revert).not.toHaveBeenCalled();
  });
});

describe("Live versions", () => {
  it("stores the first at once and the latest of the rest once per window", () => {
    const save = vi.fn<(code: string) => void>();
    const versions = new VersionCoalescer(save, () => Date.now());
    versions.live("v1");
    versions.live("v2");
    versions.live("v3");
    expect(save.mock.calls).toEqual([["v1"]]);
    vi.advanceTimersByTime(LIVE_VERSION_MS);
    expect(save.mock.calls).toEqual([["v1"], ["v3"]]);
    vi.advanceTimersByTime(LIVE_VERSION_MS);
    versions.live("v4");
    expect(save.mock.calls.at(-1)).toEqual(["v4"]);
  });

  it("saves a Ctrl+Enter at once and drops the Live version waiting behind it", () => {
    const save = vi.fn<(code: string) => void>();
    const versions = new VersionCoalescer(save, () => Date.now());
    versions.live("v1");
    versions.live("v2");
    versions.explicit("mine");
    vi.advanceTimersByTime(LIVE_VERSION_MS * 2);
    expect(save.mock.calls).toEqual([["v1"], ["mine"]]);
  });
});

describe("serial", () => {
  it("runs jobs one at a time, in order, even when one fails", async () => {
    vi.useRealTimers();
    const run = serial();
    const log: string[] = [];
    const job =
      (name: string, fail = false) =>
      async () => {
        log.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      };
    const a = run(job("a", true));
    const b = run(job("b"));
    await expect(a).rejects.toThrow("a");
    expect(await b).toBe("b");
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });
});

describe("stopping", () => {
  it("drops a Live evaluation that waits from before the stop", () => {
    const { live, evaluate } = setup();
    live.onEdit("a", on);
    live.onPlayingChange(false);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS * 2);
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe("VersionCoalescer.flush", () => {
  it("saves a waiting Live version at once, for the session the user leaves", () => {
    const saved: string[] = [];
    const timers = { setTimeout: () => 1, clearTimeout: () => {} };
    let t = 0;
    const c = new VersionCoalescer(
      (code) => saved.push(code),
      () => t,
      timers,
      10_000,
    );
    c.live("a");
    t = 1000;
    c.live("b");
    expect(saved).toEqual(["a"]);
    c.flush();
    expect(saved).toEqual(["a", "b"]);
    c.flush();
    expect(saved).toEqual(["a", "b"]);
  });
});
