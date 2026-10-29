import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { shiftKey } from "./keys";
import { PrepMenu, PrepStatusBadge } from "./PrepMenu";
import { usePrep, type PrepHandle } from "./usePrep";

afterEach(cleanup);

const sample = { id: "s1", name: "song", bpm: 98, key: "A minor" };

const handle = (jobs: PrepHandle["jobs"] = {}) => ({ jobs, start: vi.fn(async () => {}) });

describe("PrepMenu", () => {
  it("splits stems from the menu", async () => {
    const prep = handle();
    render(<PrepMenu sample={sample} prep={prep} />);
    await userEvent.click(screen.getByRole("button", { name: "Prep song" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Split stems" }));
    expect(prep.start).toHaveBeenCalledWith("s1", { split: true });
  });

  it("asks for a target tempo, starting from the sample's BPM", async () => {
    const prep = handle();
    render(<PrepMenu sample={sample} prep={prep} />);
    await userEvent.click(screen.getByRole("button", { name: "Prep song" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Match tempo..." }));
    const input = screen.getByRole("spinbutton", { name: "Target tempo" });
    expect(input).toHaveValue(98);
    await userEvent.clear(input);
    await userEvent.type(input, "300");
    expect(screen.getByRole("button", { name: "Match tempo" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "120");
    await userEvent.click(screen.getByRole("button", { name: "Match tempo" }));
    expect(prep.start).toHaveBeenCalledWith("s1", { tempo: 120, sourceBpm: 98 });
  });

  it("shows the detected BPM and lets the user halve or double it", async () => {
    const prep = handle();
    render(<PrepMenu sample={{ ...sample, bpm: 120 }} prep={prep} />);
    await userEvent.click(screen.getByRole("button", { name: "Prep song" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Match tempo..." }));
    expect(screen.getByText(/Detected 120 BPM/)).toBeInTheDocument();
    const source = screen.getByRole("spinbutton", { name: "Source tempo" });
    expect(source).toHaveValue(120);
    await userEvent.click(screen.getByRole("button", { name: "Halve the source tempo" }));
    expect(source).toHaveValue(60);
    await userEvent.click(screen.getByRole("button", { name: "Double the source tempo" }));
    await userEvent.click(screen.getByRole("button", { name: "Halve the source tempo" }));
    const target = screen.getByRole("spinbutton", { name: "Target tempo" });
    await userEvent.clear(target);
    await userEvent.type(target, "90");
    await userEvent.click(screen.getByRole("button", { name: "Match tempo" }));
    expect(prep.start).toHaveBeenCalledWith("s1", { tempo: 90, sourceBpm: 60 });
  });

  it("leaves the source tempo to the worker when none is detected", async () => {
    const prep = handle();
    render(<PrepMenu sample={{ id: "s2", name: "raw" }} prep={prep} />);
    await userEvent.click(screen.getByRole("button", { name: "Prep raw" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Match tempo..." }));
    expect(screen.getByText(/Not detected yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Halve the source tempo" })).toBeDisabled();
    const source = screen.getByRole("spinbutton", { name: "Source tempo" });
    await userEvent.type(source, "10");
    expect(screen.getByRole("button", { name: "Match tempo" })).toBeDisabled();
    await userEvent.clear(source);
    await userEvent.click(screen.getByRole("button", { name: "Match tempo" }));
    expect(prep.start).toHaveBeenCalledWith("s2", { tempo: 120 });
  });

  it("is disabled while a job runs", () => {
    render(<PrepMenu sample={sample} prep={handle({ s1: { status: "running", jobId: "j" } })} />);
    expect(screen.getByRole("button", { name: "Prep song" })).toBeDisabled();
  });
});

describe("PrepStatusBadge", () => {
  it("shows each state", () => {
    const { rerender } = render(<PrepStatusBadge state={{ status: "queued", jobId: "j" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Queued");
    rerender(<PrepStatusBadge state={{ status: "done", sampleIds: ["a", "b", "c", "d"] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("4 new samples");
    rerender(
      <TooltipProvider>
        <PrepStatusBadge state={{ status: "failed", error: "too long" }} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Prep failed");
  });
});

describe("usePrep", () => {
  it("starts a job, polls it to done and calls onDone", async () => {
    const statuses = [{ status: "running" as const }, { status: "done" as const, sampleIds: ["p1"] }];
    const api = {
      startPrep: vi.fn(async () => ({ jobId: "j1" })),
      prepStatus: vi.fn(async () => statuses.shift() ?? { status: "done" as const, sampleIds: ["p1"] }),
    };
    const onDone = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => usePrep(api, onDone));
    await act(() => result.current.start("s1", { semitones: 2 }));
    expect(api.startPrep).toHaveBeenCalledWith({ sampleId: "s1", ops: { semitones: 2 } });
    await waitFor(() => expect(result.current.jobs.s1?.status).toBe("running"));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(result.current.jobs.s1).toEqual({ status: "done", sampleIds: ["p1"], jobId: "j1" }));
    expect(onDone).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("records a start failure", async () => {
    const api = { startPrep: vi.fn(async () => Promise.reject(new Error("busy"))), prepStatus: vi.fn() };
    const { result } = renderHook(() => usePrep(api));
    await act(() => result.current.start("s1", { split: true }));
    expect(result.current.jobs.s1).toEqual({ status: "failed", error: "busy" });
  });
});

describe("shiftKey", () => {
  it("wraps around the octave", () => {
    expect(shiftKey("A minor", 3)).toBe("C minor");
    expect(shiftKey("C major", -1)).toBe("B major");
    expect(shiftKey(undefined, 2)).toBeUndefined();
  });
});
