import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvalNote } from "./EvalNote";

describe("EvalNote", () => {
  it("renders nothing without an error", () => {
    const { container } = render(<EvalNote message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("frames an error as a happy accident", () => {
    render(<EvalNote message="sd is not defined" />);
    expect(screen.getByRole("status")).toHaveTextContent("Happy accident:sd is not defined");
  });
});
