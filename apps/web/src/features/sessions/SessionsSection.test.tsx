import type { Session } from "@jam/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionsSection } from "./SessionsSection";
import type { SessionsHandle } from "./useSessions";

const session = (id: string, name: string, versionCount: number): Session => ({
  id,
  name,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  lastCode: "",
  versionCount,
  planId: null,
});

function handle(): SessionsHandle {
  return {
    sessions: [session("a", "Rainy loop", 2), session("b", "Night drive", 1)],
    currentId: "a",
    create: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    duplicate: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    loadVersions: vi.fn(async () => ({
      versions: [
        {
          id: "v2",
          code: "s('bd sd')",
          createdAt: "2026-10-01T10:05:00Z",
          evaluatedAt: "",
          evalCount: 1,
          summary: "s('bd sd')",
        },
        {
          id: "v1",
          code: "s('bd')",
          createdAt: "2026-10-01T10:00:00Z",
          evaluatedAt: "",
          evalCount: 1,
          summary: "s('bd')",
        },
      ],
      nextBefore: "2026-10-01T10:00:00Z",
    })),
  };
}

describe("SessionsSection", () => {
  it("lists sessions with counts and marks the open one", () => {
    render(<SessionsSection signedIn sessions={handle()} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveTextContent("2 versions");
    expect(rows[0]).toHaveTextContent("5 min ago");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });

  it("opens another session", () => {
    const h = handle();
    render(<SessionsSection signedIn sessions={h} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(h.open).toHaveBeenCalledWith("b");
  });

  it("lists versions newest first, and Restore hands the code over", async () => {
    const h = handle();
    render(<SessionsSection signedIn sessions={h} />);
    fireEvent.click(screen.getByRole("button", { name: "Show versions of Rainy loop" }));
    const list = await screen.findByRole("list", { name: "Rainy loop versions" });
    expect(list).toHaveTextContent(/s\('bd sd'\).*s\('bd'\)/);
    fireEvent.click(screen.getAllByRole("button", { name: /^Restore version/ })[1] as HTMLElement);
    expect(h.restore).toHaveBeenCalledWith("a", expect.objectContaining({ code: "s('bd')" }));
    fireEvent.click(screen.getByRole("button", { name: "Show older versions" }));
    await waitFor(() => expect(h.loadVersions).toHaveBeenLastCalledWith("a", "2026-10-01T10:00:00Z"));
  });

  it("asks before it deletes", async () => {
    const h = handle();
    render(<SessionsSection signedIn sessions={h} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(screen.getByRole("button", { name: "More for Night drive" }), { button: 0 });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    }
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledWith("b");
  });

  it("asks a signed-out user to sign in", () => {
    render(<SessionsSection signedIn={false} sessions={handle()} />);
    expect(screen.getByText(/Sign in to keep named sessions/)).toBeInTheDocument();
  });
});

describe("SessionsSection share links", () => {
  const share = (id: string, title: string, enabled: boolean, sessionId = "a") => ({
    id,
    sessionId,
    versionId: "v2",
    title,
    ownerName: "Tejas",
    asOf: "2026-10-01T10:05:00Z",
    bars: 24,
    seconds: 38.4,
    showCode: false,
    enabled,
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    plays: 3,
  });
  const sharesHandle = (list: ReturnType<typeof share>[]) => ({
    shares: list,
    setEnabled: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    added: vi.fn(),
  });

  it("shows a session's links as one line that opens the list, and turns them off and on", () => {
    const shares = sharesHandle([share("aaaaaaaaaa", "Loop for Sam", true), share("bbbbbbbbbb", "Old sketch", false)]);
    render(<SessionsSection signedIn sessions={handle()} shares={shares} />);
    expect(screen.queryByRole("list", { name: "Links to Rainy loop" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show links to Rainy loop" });
    expect(toggle).toHaveTextContent("2 links, 1 on");
    expect(screen.queryByRole("button", { name: "Show links to Night drive" })).toBeNull();
    fireEvent.click(toggle);

    const list = screen.getByRole("list", { name: "Links to Rainy loop" });
    expect(list).toHaveTextContent("Loop for Sam");
    expect(list).toHaveTextContent("0:38");
    expect(list).toHaveTextContent("3 plays");
    // A turned-off link has no copy button.
    expect(screen.getByRole("button", { name: "Copy link to Loop for Sam" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link to Old sketch" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Turn off the link to Loop for Sam" }));
    expect(shares.setEnabled).toHaveBeenCalledWith("aaaaaaaaaa", false);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the link to Old sketch" }));
    expect(shares.setEnabled).toHaveBeenCalledWith("bbbbbbbbbb", true);
  });

  it("deletes a turned-off link after a confirm; a link that is on has no Delete", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const shares = sharesHandle([share("aaaaaaaaaa", "Loop for Sam", true), share("bbbbbbbbbb", "Old sketch", false)]);
    render(<SessionsSection signedIn sessions={handle()} shares={shares} />);
    fireEvent.click(screen.getByRole("button", { name: "Show links to Rainy loop" }));
    expect(screen.queryByRole("button", { name: "Delete the link to Loop for Sam" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete the link to Old sketch" }));
    expect(confirm).toHaveBeenCalled();
    expect(shares.remove).toHaveBeenCalledWith("bbbbbbbbbb");
    confirm.mockRestore();
  });

  it("lists links whose session is gone, so they can still be turned off", () => {
    const shares = sharesHandle([share("cccccccccc", "Lost loop", true, "gone")]);
    render(<SessionsSection signedIn sessions={handle()} shares={shares} />);
    const list = screen.getByRole("list", { name: "Links of deleted sessions" });
    expect(list).toHaveTextContent("Lost loop");
    fireEvent.click(screen.getByRole("button", { name: "Turn off the link to Lost loop" }));
    expect(shares.setEnabled).toHaveBeenCalledWith("cccccccccc", false);
  });

  it("says a session's links go with it, and reloads the links after the delete", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const sessions = handle();
    const shares = sharesHandle([share("aaaaaaaaaa", "Loop for Sam", true)]);
    render(<SessionsSection signedIn sessions={sessions} shares={shares} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "More for Rainy loop" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(confirm.mock.calls[0]?.[0]).toContain("Its 1 link and its audio are deleted too.");
    await waitFor(() => expect(shares.refresh).toHaveBeenCalled());
    expect(sessions.remove).toHaveBeenCalledWith("a");
    confirm.mockRestore();
  });
});
