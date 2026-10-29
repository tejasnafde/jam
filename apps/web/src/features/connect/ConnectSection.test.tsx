import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { claudeCommand } from "./claudeCommand";
import { ConnectSection } from "./ConnectSection";
import { lastUsed } from "./lastUsed";

const base = {
  origin: "https://jam.tn07.dev",
  tokens: [],
  fresh: null,
  onCreate: () => {},
  onRevoke: () => {},
};

describe("ConnectSection", () => {
  it("asks a signed-out user to sign in and offers no form", () => {
    render(<ConnectSection {...base} signedIn={false} />);
    expect(screen.getByText(/Sign in to create a key/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create key" })).not.toBeInTheDocument();
  });

  it("creates a key with the typed name", async () => {
    const onCreate = vi.fn();
    render(<ConnectSection {...base} signedIn onCreate={onCreate} />);
    await userEvent.type(screen.getByLabelText("Key name"), "Claude Code");
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(onCreate).toHaveBeenCalledWith("Claude Code");
  });

  it("shows a fresh key once, with the Claude Code command", () => {
    render(<ConnectSection {...base} signedIn fresh="jam_abc" />);
    expect(screen.getByText("Copy this key now. It is shown once.")).toBeInTheDocument();
    expect(screen.getByText(claudeCommand(base.origin, "jam_abc"))).toBeInTheDocument();
  });
});

describe("claudeCommand", () => {
  it("passes the token in a header, never in the URL", () => {
    const cmd = claudeCommand("https://jam.tn07.dev", "jam_x");
    expect(cmd).toBe(
      'claude mcp add --transport http jam https://jam.tn07.dev/mcp --header "Authorization: Bearer jam_x"',
    );
  });
});

describe("lastUsed", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  it("formats relative times", () => {
    expect(lastUsed(null, now)).toBe("never used");
    expect(lastUsed("2026-10-30T11:55:00Z", now)).toBe("used 5 min ago");
    expect(lastUsed("2026-10-30T09:00:00Z", now)).toBe("used 3 h ago");
    expect(lastUsed("2026-10-25T12:00:00Z", now)).toBe("used 5 d ago");
  });
});
