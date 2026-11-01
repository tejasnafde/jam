import { describe, expect, it, vi } from "vitest";
import { evaluateShown, type CodePlayer } from "./shownCode";

function player(active: string | null, evaluates = true) {
  const p = {
    active,
    getActiveCode: () => p.active,
    evaluateQuiet: vi.fn(async (code: string) => {
      if (evaluates) p.active = code;
    }),
  };
  return p satisfies CodePlayer;
}

describe("evaluateShown", () => {
  it("does nothing when Strudel already plays the shown code", async () => {
    const p = player('$: s("bd")');
    expect(await evaluateShown(p, '$: s("bd")')).toBe(true);
    expect(p.evaluateQuiet).not.toHaveBeenCalled();
  });

  it("evaluates the shown session's code when another session's pattern is loaded", async () => {
    const p = player('$: s("session A")');
    expect(await evaluateShown(p, '$: s("session B")')).toBe(true);
    expect(p.evaluateQuiet).toHaveBeenCalledWith('$: s("session B")');
    expect(p.active).toBe('$: s("session B")');
  });

  it("refuses when the shown code does not evaluate, or Strudel is not loaded", async () => {
    expect(await evaluateShown(player('$: s("A")', false), '$: s("B"')).toBe(false);
    expect(await evaluateShown(null, '$: s("B")')).toBe(false);
  });
});
