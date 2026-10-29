import type { SessionPlan } from "@jam/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanSection } from "./PlanSection";

const plan: SessionPlan = {
  id: "p1",
  destination: "A rainy lofi loop",
  currentStage: 1,
  createdAt: "",
  updatedAt: "",
  stages: [
    { title: "Lay the floor", goal: "Lazy drums" },
    { title: "Add the rain", goal: "A soft high texture", hint: "Try degradeBy" },
    { title: "Chords", goal: "Four warm chords" },
    { title: "Bass", goal: "Follow the roots", hint: "hidden until current" },
  ],
};

describe("PlanSection", () => {
  it("shows the friendly empty state", () => {
    render(<PlanSection plan={null} signedIn />);
    expect(screen.getByText("No painting yet. Ask your coach to start a session.")).toBeInTheDocument();
  });

  it("highlights the current stage and shows only its goal and hint", () => {
    render(<PlanSection plan={plan} signedIn />);
    expect(screen.getByText("A rainy lofi loop")).toBeInTheDocument();
    const current = screen.getByRole("listitem", { current: "step" });
    expect(current).toHaveTextContent("Add the rain");
    expect(current).toHaveTextContent("Hint: Try degradeBy");
    expect(screen.queryByText(/hidden until current/)).not.toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.dataset.state)).toEqual(["done", "current", "todo", "todo"]);
  });
});
