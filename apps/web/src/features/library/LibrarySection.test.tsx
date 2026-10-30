import type { SampleWithUrl } from "@jam/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PrepHandle } from "@/features/prep/usePrep";
import { LibrarySection } from "./LibrarySection";
import { contentTypeOf, sampleFacts, sortDroppedFiles, toSampleName } from "./sampleFile";

const take: SampleWithUrl = {
  id: "s1",
  userId: "u",
  name: "mytake",
  kind: "take",
  storagePath: "users/u/samples/s1.wav",
  contentType: "audio/wav",
  durationSec: 3.24,
  bpm: 92,
  key: "F# minor",
  ops: [],
  createdAt: "",
  url: "https://example.test/s1",
};

describe("sample file helpers", () => {
  it("makes Strudel-safe, unused names", () => {
    expect(toSampleName("My Song (v2).mp3", new Set())).toBe("my_song_v2");
    expect(toSampleName("01 - intro.wav", new Set())).toBe("intro");
    expect(toSampleName("x.wav", new Set())).toBe("sample");
    expect(toSampleName("kick.wav", new Set(["kick", "kick_2"]))).toBe("kick_3");
    expect(toSampleName("a".repeat(80) + ".wav", new Set(["a".repeat(34)]))).toMatch(/^a{34}_2$/);
  });

  it("accepts only mp3 and wav", () => {
    expect(contentTypeOf("a.MP3")).toBe("audio/mpeg");
    expect(contentTypeOf("a.wav")).toBe("audio/wav");
    expect(contentTypeOf("a.flac")).toBeNull();
  });

  it("formats the facts line", () => {
    expect(sampleFacts(take)).toBe("3.2 s · 92 BPM · F# minor");
  });
});

describe("LibrarySection", () => {
  it("asks a signed-out user to sign in", () => {
    render(<LibrarySection signedIn={false} samples={[]} uploading={false} onUpload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/Sign in to keep your own samples/)).toBeInTheDocument();
  });

  it("lists samples and deletes after a confirm", async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LibrarySection signedIn samples={[take]} uploading={false} onUpload={vi.fn()} onDelete={onDelete} />);
    expect(screen.getByText("mytake")).toBeInTheDocument();
    expect(screen.getByText("take")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete mytake" }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("passes the chosen file to onUpload", async () => {
    const onUpload = vi.fn();
    render(<LibrarySection signedIn samples={[]} uploading={false} onUpload={onUpload} onDelete={vi.fn()} />);
    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    await userEvent.upload(screen.getByLabelText("Audio file"), file);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("has a Prep menu on each row when prep is on", async () => {
    const prep: PrepHandle = { jobs: {}, start: vi.fn(async () => {}) };
    render(
      <LibrarySection signedIn samples={[take]} uploading={false} onUpload={vi.fn()} onDelete={vi.fn()} prep={prep} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Prep mytake" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Split stems" }));
    expect(prep.start).toHaveBeenCalledWith("s1", { split: true });
  });

  it("shows the prep status and keeps the source while a job runs", () => {
    const prep: PrepHandle = { jobs: { s1: { status: "running", jobId: "j1" } }, start: vi.fn() };
    render(
      <TooltipProvider>
        <LibrarySection signedIn samples={[take]} uploading={false} onUpload={vi.fn()} onDelete={vi.fn()} prep={prep} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Preparing");
    expect(screen.getByRole("button", { name: "Delete mytake" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Prep mytake" })).toBeDisabled();
  });

  it("hides the Prep menu without a prep handle", () => {
    render(<LibrarySection signedIn samples={[take]} uploading={false} onUpload={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Prep mytake" })).toBeNull();
  });
});

describe("dropped files", () => {
  const file = (name: string, size: number) => ({ name, size });

  it("accepts mp3 and wav up to 50 MB and says why it refuses the rest", () => {
    const { accepted, rejected } = sortDroppedFiles([
      file("a.mp3", 10),
      file("b.WAV", 50 * 1024 * 1024),
      file("c.flac", 10),
      file("d.wav", 50 * 1024 * 1024 + 1),
      file("e.mp3", 0),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.mp3", "b.WAV"]);
    expect(rejected).toEqual([
      { name: "c.flac", reason: "is not an mp3 or wav file" },
      { name: "d.wav", reason: "is larger than 50 MB" },
      { name: "e.mp3", reason: "is empty" },
    ]);
  });

  it("uploads audio files dropped on the Library", () => {
    const onUpload = vi.fn();
    render(<LibrarySection signedIn samples={[]} uploading={false} onUpload={onUpload} onDelete={vi.fn()} />);
    const song = new File(["x"], "song.wav", { type: "audio/wav" });
    const text = new File(["x"], "notes.txt", { type: "text/plain" });
    const dataTransfer = { types: ["Files"], files: [song, text], dropEffect: "" };
    fireEvent.drop(screen.getByTestId("library-drop"), { dataTransfer });
    expect(onUpload).toHaveBeenCalledExactlyOnceWith(song);
  });
});
