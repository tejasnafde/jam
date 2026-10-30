import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoundCatalog } from "./useSoundCatalog";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).soundMap;
});

describe("useSoundCatalog", () => {
  it("stops reading Strudel's map after unmount, when the map was there from the start", () => {
    let notify = () => {};
    const unlisten = vi.fn();
    const get = vi.fn(() => ({ sawtooth: { data: { type: "synth" } } }));
    (globalThis as Record<string, unknown>).soundMap = {
      get,
      listen: (cb: () => void) => {
        notify = cb;
        return unlisten;
      },
    };
    const yours: string[] = [];
    const { result, unmount } = renderHook(() => useSoundCatalog(yours));
    expect(result.current.source).toBe("strudel");
    expect(result.current.catalog.synths).toHaveLength(1);
    act(() => notify());
    unmount();
    expect(unlisten).toHaveBeenCalled();
    const reads = get.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(get).toHaveBeenCalledTimes(reads);
  });
});
