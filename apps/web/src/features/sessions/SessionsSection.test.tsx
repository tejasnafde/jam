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
