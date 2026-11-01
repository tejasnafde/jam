import { describe, expect, it } from "vitest";
import { decideFallback, SILENT_PEAK } from "./fallback";
import { RenderCancelled, RenderFailed, RenderTimeout } from "./render/protocol";

describe("decideFallback", () => {
  it("uploads a render with sound", () => {
    expect(decideFallback({ ok: true, peak: 0.4 }, true)).toEqual({ kind: "upload" });
    expect(decideFallback({ ok: true, peak: SILENT_PEAK }, false)).toEqual({ kind: "upload" });
  });

  it("offers real time for a silent render of audible music", () => {
    expect(decideFallback({ ok: true, peak: 0.0001 }, true).kind).toBe("offerRealtime");
  });

  it("fails without real time for a silent render when nothing plays", () => {
    expect(decideFallback({ ok: true, peak: 0 }, false).kind).toBe("fail");
  });

  it("offers real time on a timeout or a render error", () => {
    expect(decideFallback({ ok: false, error: new RenderTimeout(60) }, false)).toEqual({
      kind: "offerRealtime",
      message: "The render took more than 60 s.",
    });
    expect(decideFallback({ ok: false, error: new RenderFailed("worklet") }, false).kind).toBe("offerRealtime");
    expect(decideFallback({ ok: false, error: "odd" }, false).kind).toBe("offerRealtime");
  });

  it("does not offer real time when the code itself does not run", () => {
    expect(decideFallback({ ok: false, error: new RenderFailed("The code does not run", true) }, true).kind).toBe(
      "fail",
    );
  });

  it("reports a cancel as a cancel", () => {
    expect(decideFallback({ ok: false, error: new RenderCancelled() }, true)).toEqual({ kind: "cancelled" });
  });
});
