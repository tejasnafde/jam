import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "@/lib/api";
import { useEvaluationRecorder } from "./useEvaluationRecorder";

vi.mock("@/lib/audio", () => ({ measure: vi.fn(async () => null) }));

describe("useEvaluationRecorder", () => {
  it("when the session was deleted elsewhere, saves the version in the session that rescued the code", async () => {
    let sessionId = "gone";
    const saveVersion = vi.fn(async (_code: string, id?: string) => {
      if (id === "gone") throw new ApiError(404, "That session does not exist.");
      return { id: "v1" };
    });
    const api = { saveVersion } as unknown as Api;
    const onSessionGone = vi.fn(async () => {
      sessionId = "rescued";
    });
    const statuses: string[] = [];
    const { result } = renderHook(() =>
      useEvaluationRecorder(
        api,
        () => false,
        (s) => statuses.push(s),
        () => sessionId,
        undefined,
        onSessionGone,
      ),
    );
    await result.current("s('bd')");
    expect(onSessionGone).toHaveBeenCalledOnce();
    expect(saveVersion).toHaveBeenLastCalledWith("s('bd')", "rescued");
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("other failures still show failed", async () => {
    const api = { saveVersion: vi.fn(async () => Promise.reject(new ApiError(500, "boom"))) } as unknown as Api;
    const onSessionGone = vi.fn(async () => {});
    const statuses: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useEvaluationRecorder(
        api,
        () => false,
        (s) => statuses.push(s),
        () => "a",
        undefined,
        onSessionGone,
      ),
    );
    await result.current("x");
    expect(onSessionGone).not.toHaveBeenCalled();
    expect(statuses).toEqual(["saving", "failed"]);
  });
});
