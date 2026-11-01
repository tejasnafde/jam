import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scheduler } from "@/features/editor/strudelTypes";
import { createApi } from "@/lib/api";
import { ShareDialog } from "./ShareDialog";

const capturePass = vi.fn(async () => ({
  channels: [new Float32Array(48), new Float32Array(48)] as [Float32Array, Float32Array],
  sampleRate: 48_000,
}));
vi.mock("./capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./capture")>()),
  capturePass: (...args: unknown[]) => capturePass(...(args as [])),
}));

const SESSION_B = '$: s("<bd sd hh>")';
const VERSION = { id: "vB", code: SESSION_B, createdAt: "", evaluatedAt: "2026-10-31T10:00:00Z", evalCount: 1 };
const SHARE = {
  id: "abcDEF1234",
  sessionId: "b",
  versionId: "vB",
  title: "Session B",
  ownerName: "Tejas",
  asOf: VERSION.evaluatedAt,
  bars: 3,
  seconds: 6,
  showCode: false,
  enabled: true,
  createdAt: "",
  plays: 0,
};

/** Answers the page API and the signed upload, and logs each call as "METHOD path". */
function fakeServer() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^\/api/, "");
      calls.push(`${init.method ?? "GET"} ${path}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (path.startsWith("/sessions/b/versions")) return json({ versions: [VERSION], nextBefore: null });
      if (path === "/shares")
        return json({ id: SHARE.id, uploadUrl: "https://storage.test/up", url: "https://x/s/1" }, 201);
      if (path.endsWith("/ready")) return json(SHARE);
      if (url === "https://storage.test/up") return new Response("", { status: 200 });
      return json({ error: "not_found" }, 404);
    }),
  );
  return calls;
}

function renderDialog(playCode: (code: string) => Promise<boolean>) {
  // Strudel still holds session A's pattern.
  const scheduler: Scheduler = { pattern: "session A", start: vi.fn(), stop: vi.fn() };
  const onCreated = vi.fn();
  render(
    <ShareDialog
      open
      onOpenChange={() => {}}
      api={createApi(async () => "token")}
      sessionId="b"
      sessionName="Session B"
      displayName="Tejas N"
      getScheduler={() => scheduler}
      getCps={() => 0.5}
      playCode={playCode}
      flushVersions={() => {}}
      onCreated={onCreated}
    />,
  );
  return { onCreated };
}

afterEach(() => {
  vi.unstubAllGlobals();
  capturePass.mockClear();
});

describe("ShareDialog", () => {
  it("evaluates the shown session's code before it records", async () => {
    const calls = fakeServer();
    const order: string[] = [];
    const playCode = vi.fn(async (code: string) => {
      order.push(`play ${code}`);
      return true;
    });
    capturePass.mockImplementationOnce(async () => {
      order.push("record");
      return { channels: [new Float32Array(48), new Float32Array(48)], sampleRate: 48_000 };
    });
    const { onCreated } = renderDialog(playCode);
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(order).toEqual([`play ${SESSION_B}`, "record"]);
    expect(capturePass).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cycles: 3, seconds: 6 }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(calls).toContain("POST /shares");
  });

  it("refuses, and starts no link, when the shown code does not evaluate", async () => {
    const calls = fakeServer();
    renderDialog(async () => false);
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Play this session once, then share it.");
    expect(calls).not.toContain("POST /shares");
    expect(capturePass).not.toHaveBeenCalled();
  });

  it("deletes the unfinished link when the recording fails", async () => {
    const calls = fakeServer();
    capturePass.mockImplementationOnce(async () => {
      throw new Error("The tab was hidden.");
    });
    renderDialog(async () => true);
    fireEvent.click(await screen.findByRole("button", { name: "Create link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The tab was hidden.");
    await waitFor(() => expect(calls).toContain(`DELETE /shares/${SHARE.id}`));
  });
});
