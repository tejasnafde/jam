import type { Session, SessionListResponse } from "@jam/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_CODE_KEY } from "@/features/editor/defaultCode";
import { toast } from "sonner";
import { ApiError, type Api } from "@/lib/api";
import { DRAFT_SAVE_MS, useSessions, type EditorBridge } from "./useSessions";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

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
    duplicateSession: vi.fn(async (id: string) => ({ ...session(`${id}-copy`, "", 50), name: `${id} copy` })),
    deleteSession: vi.fn(async () => null),
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
    stopLive: vi.fn(() => calls.push("stop")),
    evaluate,
    play: evaluate,
  };
  return { api, editor, calls, evaluate };
}

describe("useSessions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(toast).mockClear();
  });

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
    // Live mode stops before the new text arrives, so the old piece does not play under it.
    expect(calls).toEqual(["flush", "open b", "stop", "replace b code"]);
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
      await act(() => result.current.handle.restore("a", { code: "older", createdAt: "2026-10-01T10:29:00Z" }));
      expect(editor.replaceCode).toHaveBeenLastCalledWith("older");
      expect(api.openSession).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        expect.stringMatching(/^Put the version from .+ in the editor\. \w+\+Z brings/),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS + 10);
      });
      expect(api.updateSession).toHaveBeenCalledWith("a", { lastCode: "older" }, {});
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restoring a version of another session opens that session first", async () => {
    const { api, editor, calls } = fakes({ sessions: [session("a", "x"), session("b", "y")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    await act(() => result.current.handle.restore("b", { code: "old b", createdAt: "2026-10-01T10:00:00Z" }));
    expect(calls.slice(-4)).toEqual(["open b", "stop", "replace y", "replace old b"]);
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

  it("deleting the last session puts starter code in the editor, not a blank page", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "x")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    vi.mocked(api.listSessions).mockResolvedValueOnce({ sessions: [session("untitled", "")], currentId: "untitled" });
    await act(() => result.current.handle.remove("a"));
    expect(editor.stopLive).toHaveBeenCalled();
    expect(editor.replaceCode).toHaveBeenLastCalledWith(expect.stringContaining("A new piece"));
    expect(result.current.handle.currentId).toBe("untitled");
  });

  it("duplicate says it made the copy", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "x"), session("b", "y")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    await act(() => result.current.handle.duplicate("b"));
    expect(toast).toHaveBeenCalledWith("Made b copy.");
    expect(result.current.handle.sessions.map((s) => s.id)).toContain("b-copy");
  });

  it("the draft save on tab close uses keepalive, so the browser does not drop it", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "x")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    act(() => result.current.onEdit("last lines"));
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(() =>
        expect(api.updateSession).toHaveBeenCalledWith("a", { lastCode: "last lines" }, { keepalive: true }),
      );
    } finally {
      hidden.mockRestore();
    }
  });

  it("when another tab deleted the open session, the editor text goes into a new session", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "x"), session("b", "y")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    vi.mocked(api.listSessions).mockResolvedValue({ sessions: [session("b", "y")], currentId: "b" });
    await act(() => result.current.onSessionGone());
    expect(api.createSession).toHaveBeenCalledWith("Untitled", "x");
    expect(result.current.getSessionId()).toBe("new");
    expect(toast).toHaveBeenCalledWith("That session was deleted. Your code is now in Untitled.");
  });

  it("a draft save that finds the session gone rescues the text the same way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api, editor } = fakes({ sessions: [session("a", "x")], currentId: "a" });
      const { result } = renderHook(() => useSessions(api, editor));
      await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
      vi.mocked(api.updateSession).mockRejectedValueOnce(new ApiError(404, "not_found"));
      vi.mocked(api.listSessions).mockResolvedValue({ sessions: [session("untitled", "")], currentId: "untitled" });
      act(() => result.current.onEdit("typed in a"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS + 10);
      });
      await waitFor(() => expect(result.current.getSessionId()).toBe("new"));
      expect(api.createSession).toHaveBeenCalledWith("Untitled", "x");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not rescue when the session still exists", async () => {
    const { api, editor } = fakes({ sessions: [session("a", "x")], currentId: "a" });
    const { result } = renderHook(() => useSessions(api, editor));
    await waitFor(() => expect(result.current.handle.currentId).toBe("a"));
    await act(() => result.current.onSessionGone());
    expect(api.createSession).not.toHaveBeenCalled();
  });
});
