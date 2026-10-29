import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsentView, type ConsentViewProps } from "./ConsentView";

const base: ConsentViewProps = {
  info: { clientName: "Claude", redirectHost: "claude.ai", scopes: ["jam"], expiresAt: "" },
  error: null,
  profile: null,
  authReady: true,
  busy: false,
  leavingTo: null,
  onSignIn: () => {},
  onSignOut: () => {},
  onDecide: () => {},
};

const profile = { name: "Tejas", email: "tejas@example.com", photoUrl: null };

describe("ConsentView", () => {
  it("names the app, where it returns, what it can do and what it never does", () => {
    render(<ConsentView {...base} />);
    expect(screen.getByRole("heading", { name: "Connect Claude to jam?" })).toBeInTheDocument();
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "It can" })).toHaveTextContent(/code and its history/);
    expect(screen.getByText(/Change your music/)).toBeInTheDocument();
  });

  it("asks a signed-out user to sign in and offers no Allow", async () => {
    const onSignIn = vi.fn();
    render(<ConsentView {...base} onSignIn={onSignIn} />);
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it("lets a signed-in user allow or deny", async () => {
    const onDecide = vi.fn();
    render(<ConsentView {...base} profile={profile} onDecide={onDecide} />);
    expect(screen.getByText("tejas@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecide.mock.calls).toEqual([[true], [false]]);
  });

  it("disables the buttons while a decision is sent", () => {
    render(<ConsentView {...base} profile={profile} busy />);
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
  });

  it("shows an expired request", () => {
    render(<ConsentView {...base} info={null} error="This request has expired or was already answered." />);
    expect(screen.getByText(/expired/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });
});
