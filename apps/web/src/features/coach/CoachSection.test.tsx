import type { CoachEvent, CoachThread } from "@jam/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoachSection, CoachStatus } from "./CoachSection";
import type { CoachHandle } from "./useCoach";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const events: CoachEvent[] = [
  { id: "1", sessionId: "s", kind: "ask", text: "", createdAt: at(5), status: "taken" },
  { id: "2", sessionId: "s", kind: "note", text: "Lovely. What does the hat want?", createdAt: at(4), status: null },
  { id: "3", sessionId: "s", kind: "ask", text: "And the bass?", createdAt: at(0), status: "pending" },
];

function handle(thread: Partial<CoachThread> = {}): CoachHandle {
  return {
    thread: { events: [], cadence: "ask", listeningAt: null, updatedAt: null, ...thread },
    ask: vi.fn(async () => {}),
    setCadence: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  };
}

describe("CoachSection", () => {
  it("shows the newest four, then the rest on request, and inline code as code", () => {
    const many: CoachEvent[] = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      sessionId: "s",
      kind: "note",
      text: i === 5 ? "Try `slow` on one layer?" : `note ${i}`,
      createdAt: at(10 - i),
      status: null,
    }));
    render(<CoachSection signedIn coach={handle({ events: many })} now={NOW} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("slow").tagName).toBe("CODE");
    fireEvent.click(screen.getByRole("button", { name: "Show 2 earlier" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("shows the thread newest last, with who said it and when", () => {
    render(<CoachSection signedIn coach={handle({ events })} now={NOW} />);
    const items = screen.getByRole("list", { name: "Coach thread" }).querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual([
      "You5 min agoCheck my music",
      "Coach4 min agoLovely. What does the hat want?",
      "Youwaiting for the coachAnd the bass?",
    ]);
  });

  it("sends an ask on Enter, and an empty ask from Check my music", async () => {
    const coach = handle();
    render(<CoachSection signedIn coach={coach} now={NOW} />);
    const input = screen.getByRole("textbox", { name: "Ask the coach" });
    fireEvent.change(input, { target: { value: "Too busy?" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(coach.ask).toHaveBeenCalledWith("Too busy?"));
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.click(screen.getByRole("button", { name: "Check my music" }));
    await waitFor(() => expect(coach.ask).toHaveBeenLastCalledWith(""));
  });

  it("offers the start phrase only when no coach is listening", () => {
    const { rerender } = render(<CoachSection signedIn coach={handle()} now={NOW} />);
    expect(screen.getByText("coach me live")).toBeInTheDocument();
    expect(screen.getByText(/No coach connected/)).toBeInTheDocument();
    const live = handle({ listeningAt: at(1) });
    rerender(<CoachSection signedIn coach={live} now={NOW} />);
    expect(screen.queryByText("coach me live")).not.toBeInTheDocument();
    render(<CoachStatus coach={live} now={NOW} />);
    expect(screen.getByText("Coach listening")).toBeInTheDocument();
  });

  it("shows the start phrase above the ask box, so an ask never waits unexplained", () => {
    render(<CoachSection signedIn coach={handle()} now={NOW} />);
    const hint = screen.getByText(/No coach connected/);
    const input = screen.getByRole("textbox", { name: "Ask the coach" });
    expect(hint.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("calls a coach that waited 3 minutes ago gone", () => {
    render(<CoachStatus coach={handle({ listeningAt: at(3) })} now={NOW} />);
    expect(screen.getByText("No coach")).toBeInTheDocument();
  });
});
