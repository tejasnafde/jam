import type { Session, SessionListResponse } from "@jam/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_CODE_KEY } from "@/features/editor/defaultCode";
import type { Api } from "@/lib/api";
import { DRAFT_SAVE_MS, useSessions, type EditorBridge } from "./useSessions";

const session = (id: string, lastCode: string, minutes = 0): Session => ({
  id,
  name: id,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: new Date(Date.parse("2026-10-01T00:00:00Z") + minutes * 60_000).toISOString(),
  lastCode,
  versionCount: 0,
  planId: null,
});

function fakes(list: SessionListResponse) {
  const calls: string[] = [];
  const api = {
    listSessions: vi.fn(async () => structuredClone(list)),
    openSession: vi.fn(async (id: string, _previous?: { id: string; lastCode: string }) => {
      calls.push(`open ${id}`);
      const found = list.sessions.find((s) => s.id === id) as Session;
      return { session: found, plan: null };
    }),
    updateSession: vi.fn(async (id: string, body: { name?: string; lastCode?: string }) => ({
      ...(list.sessions.find((s) => s.id === id) as Session),
      ...body,
    })),
    createSession: vi.fn(async (name: string, lastCode: string) => ({ ...session("new", lastCode, 99), name })),
    sessionVersions: vi.fn(),
  } as unknown as Api;
  let text: string | null = "typed in a";
  // A real editor can also evaluate and play. The sessions must never ask it to.
  const evaluate = vi.fn();
  const editor: EditorBridge & { evaluate: () => void; play: () => void } = {
    getCode: () => text,
    replaceCode: vi.fn((code: string) => {
      calls.push(`replace ${code}`);
      text = code;
    }),
    flushVersions: vi.fn(() => calls.push("flush")),
    evaluate,
    play: evaluate,
  };
  return { api, editor, calls, evaluate };
}

describe("useSessions", () => {
  beforeEach(() => localStorage.clear());

  it("switching saves the editor text of the session it leaves, then loads the other, without evaluating", async () => {
    const { api, editor, calls, evaluate } = fakes({
      sessions: [session("a", "typed in a"), session("b", "b code")],
      currentId: "a",
    });
    localStorage.setItem(LOCAL_CODE_KEY, "typed in a");
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    await act(() => result.current.handle.open("b"));
    expect(api.openSession).toHaveBeenCalledWith("b", { id: "a", lastCode: "typed in a" });
    // The waiting Live version goes to the old session before the switch.
    expect(calls).toEqual(["flush", "open b", "replace b code"]);
    expect(result.current.handle.currentId).toBe("b");
    expect(result.current.getSessionId()).toBe("b");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("restore puts the code in the editor as an edit and saves it, but never evaluates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api, editor, evaluate } = fakes({ sessions: [session("a", "now")], currentId: "a" });
      const { result } = renderHook(() => useSessions(api, editor));
      await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
      await act(() => result.current.handle.restore("a", "older"));
      expect(editor.replaceCode).toHaveBeenLastCalledWith("older");
      expect(api.openSession).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS + 10);
      });
      expect(api.updateSession).toHaveBeenCalledWith("a", { lastCode: "older" });
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restoring a version of another session opens that session first", async () => {
    const { api, editor, calls } = fakes({ sessions: [session("a", "x"), session("b", "y")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    await act(() => result.current.handle.restore("b", "old b"));
    expect(calls.slice(-3)).toEqual(["open b", "replace y", "replace old b"]);
  });

  it("brings back the session's code on another computer", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "from the laptop", 5)], currentId: "a" });
    localStorage.setItem(LOCAL_CODE_KEY, "old");
    localStorage.setItem("jam:code-meta", JSON.stringify({ sessionId: "a", editedAt: 0 }));
    renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(editor.replaceCode).toHaveBeenCalledWith("from the laptop"));
  });

  it("a new session saves the old text and opens with starter code", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "x")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    vi.mocked(api.openSession).mockResolvedValueOnce({ session: session("new", "starter"), plan: null });
    await act(() => result.current.handle.create());
    expect(api.createSession).toHaveBeenCalledWith("Untitled", expect.stringContaining("setcpm"));
    expect(api.openSession).toHaveBeenCalledWith("new", { id: "a", lastCode: "x" });
    expect(result.current.handle.currentId).toBe("new");
  });
});
