import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { errorLine } from "./errorLine";
import { EvalNote } from "./EvalNote";

describe("EvalNote", () => {
  it("renders nothing without an error", () => {
    const { container } = render(<EvalNote message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("frames an error as a happy accident", () => {
    render(<EvalNote message="sd is not defined" />);
    expect(screen.getByRole("status")).toHaveTextContent("Happy accident:sd is not defined");
    expect(screen.queryByRole("button", { name: /Go to line/ })).not.toBeInTheDocument();
  });

  it("offers to go to the line the error names", async () => {
    const onGoToLine = vi.fn();
    render(<EvalNote message="Unexpected token (5:12)" onGoToLine={onGoToLine} />);
    await userEvent.click(screen.getByRole("button", { name: "Go to line 5" }));
    expect(onGoToLine).toHaveBeenCalledWith(5);
  });

  it("hides when dismissed, and shows again for a new error", async () => {
    const { rerender } = render(<EvalNote message="one" />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<EvalNote message="two" />);
    expect(screen.getByRole("status")).toHaveTextContent("two");
  });

  it("shows a dismissed error again after it was fixed and came back", async () => {
    const { rerender } = render(<EvalNote message="sd is not defined" />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    rerender(<EvalNote message="sd is not defined" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<EvalNote message={null} />);
    rerender(<EvalNote message="sd is not defined" />);
    expect(screen.getByRole("status")).toHaveTextContent("sd is not defined");
  });

  it("reads line numbers from the error text", () => {
    expect(errorLine("[mini] parse error at line 3: expected ]")).toBe(3);
    expect(errorLine("SyntaxError: Unexpected token (12:4)")).toBe(12);
    expect(errorLine("sd is not defined")).toBeNull();
  });
});
