import { act, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import type { ShareDraft } from "./offlineShare";
import type { RenderDone } from "./render/protocol";
import { RenderFailed } from "./render/protocol";
import { useShareJob } from "./useShareJob";

interface ErrorToast {
  onRetry(): void;
}
const custom = vi.fn<(render: (id: number) => ReactElement<ErrorToast>) => number>(() => 7);
const dismiss = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    custom: (r: (id: number) => ReactElement<ErrorToast>) => custom(r),
    dismiss: (id: unknown) => dismiss(id),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("@/lib/audio", () => ({ measure: async () => null }));

const draft = (title: string): ShareDraft => ({
  sessionId: "s1",
  versionId: "v1",
  code: 's("bd")',
  title,
  ownerName: "T",
  bars: 4,
  cps: 0.5,
  showCode: false,
});

afterEach(() => {
  custom.mockClear();
  dismiss.mockClear();
});

describe("useShareJob", () => {
  it("ignores Retry on an old failure toast while a newer share runs, and closes that toast", async () => {
    const renders: string[] = [];
    const render = vi.fn(async (req: { code: string }, opts: { signal?: AbortSignal }) => {
      renders.push(req.code);
      if (renders.length === 1) throw new RenderFailed("worklet");
      // The second render keeps running until it is aborted.
      return new Promise<RenderDone>((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const { result } = renderHook(() =>
      useShareJob({
        api: createApi(async () => "t"),
        sampleMap: {},
        onCreated: () => {},
        onRealtime: () => {},
        render: render as never,
      }),
    );

    await act(async () => result.current.start(draft("first")));
    await vi.waitFor(() => expect(result.current.job.kind).toBe("failed"));
    const oldToast = custom.mock.calls[0]?.[0](7);

    // A new share from the dialog closes the old toast.
    act(() => result.current.start(draft("second")));
    expect(dismiss).toHaveBeenCalledWith(7);
    expect(result.current.job).toMatchObject({ kind: "preparing", title: "second" });

    // Its Retry, pressed anyway, starts nothing and does not cancel the running share.
    act(() => oldToast?.props.onRetry());
    expect(render).toHaveBeenCalledTimes(2);
    expect(result.current.job).toMatchObject({ kind: "preparing", title: "second" });
  });
});
