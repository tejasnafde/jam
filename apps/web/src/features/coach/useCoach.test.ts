import type { CoachStatus, CoachThread } from "@jam/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { useCoach } from "./useCoach";

const NOW = Date.parse("2026-10-30T12:00:00Z");

function fakeApi(status: CoachStatus) {
  const state = { status };
  const coachThread = vi.fn(async (): Promise<CoachThread> => ({ events: [], cadence: "ask", ...state.status }));
  const coachStatus = vi.fn(async () => state.status);
  const askCoach = vi.fn(async () => ({
    id: "a",
    sessionId: "s",
    kind: "ask" as const,
    text: "hi",
    createdAt: new Date(NOW).toISOString(),
    status: "pending" as const,
  }));
  const api = { coachThread, coachStatus, askCoach } as unknown as Api;
  return { api, state, coachThread, coachStatus, askCoach };
}

describe("useCoach", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("polls only the status, and reads the thread when updatedAt moves", async () => {
    const fake = fakeApi({ listeningAt: new Date(NOW).toISOString(), updatedAt: "t1" });
    renderHook(() => useCoach(fake.api, "s"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fake.coachThread).toHaveBeenCalledTimes(1);
    const before = fake.coachStatus.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fake.coachStatus.mock.calls.length).toBe(before + 1);
    expect(fake.coachThread).toHaveBeenCalledTimes(1);
    fake.state.status = { ...fake.state.status, updatedAt: "t2" };
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fake.coachThread).toHaveBeenCalledTimes(2);
  });

  it("polls every 20 s while no coach listens", async () => {
    const fake = fakeApi({ listeningAt: null, updatedAt: null });
    renderHook(() => useCoach(fake.api, "s"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(19_000));
    expect(fake.coachStatus).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fake.coachStatus).toHaveBeenCalledTimes(1);
  });

  it("reads the thread at once after an ask, and checks at once on refresh", async () => {
    const fake = fakeApi({ listeningAt: null, updatedAt: null });
    const { result } = renderHook(() => useCoach(fake.api, "s"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => result.current.ask("hi"));
    expect(fake.askCoach).toHaveBeenCalledWith("s", "hi");
    expect(fake.coachThread).toHaveBeenCalledTimes(2);
    fake.state.status = { listeningAt: null, updatedAt: "t3" };
    await act(() => result.current.refresh());
    expect(fake.coachStatus).toHaveBeenCalledTimes(1);
    expect(fake.coachThread).toHaveBeenCalledTimes(3);
  });
});
