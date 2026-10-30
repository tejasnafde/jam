import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { usePlan } from "./usePlan";

describe("usePlan", () => {
  it("asks for the plan of the session the page shows", async () => {
    const plan = { id: "p", destination: "Night drive", stages: [], currentStage: 0, createdAt: "", updatedAt: "" };
    const currentPlan = vi.fn(async () => plan);
    const api = { currentPlan } as unknown as Api;
    const { result } = renderHook(() => usePlan(api, "night"));
    await waitFor(() => expect(result.current?.destination).toBe("Night drive"));
    expect(currentPlan).toHaveBeenCalledWith("night");
  });
});
