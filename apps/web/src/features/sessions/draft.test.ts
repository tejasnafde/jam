import type { Session } from "@jam/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_CODE } from "@/features/editor/defaultCode";
import { freshName, relativeTime, startCode } from "./draft";

const session = (patch: Partial<Session> = {}): Session => ({
  id: "s1",
  name: "Beat",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T12:00:00Z",
  lastCode: "server code",
  versionCount: 1,
  planId: null,
  ...patch,
});
const at = (iso: string) => Date.parse(iso);

describe("startCode", () => {
  it("loads the session's code when this browser has nothing of its own", () => {
    expect(startCode(session(), { code: null, meta: null })).toBe("server code");
    expect(startCode(session(), { code: DEFAULT_CODE, meta: null })).toBe("server code");
  });

  it("keeps text written before sessions existed (or while signed out)", () => {
    expect(startCode(session(), { code: "mine", meta: null })).toBeNull();
    expect(startCode(session(), { code: "mine", meta: { sessionId: null, editedAt: 0 } })).toBeNull();
  });

  it("keeps this browser's text when it is newer than the session's last save", () => {
    const local = { code: "mine", meta: { sessionId: "s1", editedAt: at("2026-10-01T13:00:00Z") } };
    expect(startCode(session(), local)).toBeNull();
  });

  it("loads the session's code when another computer saved it later", () => {
    const local = { code: "stale", meta: { sessionId: "s1", editedAt: at("2026-10-01T11:00:00Z") } };
    expect(startCode(session(), local)).toBe("server code");
  });

  it("loads the session's code when the browser's text belongs to another session", () => {
    const local = { code: "other", meta: { sessionId: "s2", editedAt: at("2026-10-02T00:00:00Z") } };
    expect(startCode(session(), local)).toBe("server code");
  });

  it("leaves the editor alone for an empty session or the same text", () => {
    expect(startCode(session({ lastCode: "" }), { code: "x", meta: null })).toBeNull();
    expect(startCode(session(), { code: "server code", meta: null })).toBeNull();
  });
});

describe("helpers", () => {
  it("picks the first free Untitled name", () => {
    expect(freshName([])).toBe("Untitled");
    expect(freshName([{ name: "Untitled" }, { name: "Untitled 2" }])).toBe("Untitled 3");
  });

  it("writes relative times", () => {
    const now = at("2026-10-30T12:00:00Z");
    expect(relativeTime("2026-10-30T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-30T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-10-30T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-10-28T12:00:00Z", now)).toBe("2 d ago");
  });
});
