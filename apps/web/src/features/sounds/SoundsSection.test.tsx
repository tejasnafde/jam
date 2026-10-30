import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildCatalog, type Catalog, type RawSound } from "./catalog";
import { SOUND_MIME } from "./dragState";
import { SoundsSection } from "./SoundsSection";

const raw: RawSound[] = [
  { key: "rolandtr909_bd", type: "sample", variants: 1, drum: { machine: "RolandTR909", part: "bd" } },
  { key: "rolandtr909_sd", type: "sample", variants: 1, drum: { machine: "RolandTR909", part: "sd" } },
  { key: "casio", type: "sample", variants: 3 },
  { key: "gm_flute", type: "soundfont" },
  { key: "sawtooth", type: "synth" },
  ...Array.from({ length: 50 }, (_, i): RawSound => ({ key: `s${String(i).padStart(2, "0")}`, type: "sample" })),
];
const catalog = buildCatalog(raw, ["my_loop"]);

function setup(c: Catalog = catalog) {
  const onInsert = vi.fn(() => true);
  render(
    <TooltipProvider>
      <SoundsSection catalog={c} source="strudel" onInsert={onInsert} />
    </TooltipProvider>,
  );
  return { onInsert, user: userEvent.setup() };
}

describe("SoundsSection", () => {
  it("shows each group with its count, collapsed", () => {
    setup();
    for (const [name, count] of [
      ["Drum machines", "1"],
      ["Samples", "51"],
      ["Instruments", "1"],
      ["Synths", "1"],
      ["Yours", "1"],
    ]) {
      const heading = screen.getByRole("button", { name: `${name}, ${count}` });
      expect(heading).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("expands a drum machine into its parts, and inserts a part at the cursor", async () => {
    const { user, onInsert } = setup();
    await user.click(screen.getByRole("button", { name: "Drum machines, 1" }));
    await user.click(screen.getByRole("button", { name: /RolandTR909/ }));
    const parts = screen.getByRole("list", { name: "RolandTR909 parts" });
    expect(within(parts).getByText("kick")).toBeInTheDocument();
    await user.click(within(parts).getByRole("button", { name: 'Insert s("bd").bank("RolandTR909") at cursor' }));
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ name: "bd", machine: "RolandTR909" }));
  });

  it("renders long groups a page at a time", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Samples, 51" }));
    expect(within(screen.getByRole("list", { name: "Samples" })).getAllByRole("listitem")).toHaveLength(40);
    await user.click(screen.getByRole("button", { name: "Show 11 more (11 left)" }));
    expect(within(screen.getByRole("list", { name: "Samples" })).getAllByRole("listitem")).toHaveLength(51);
  });

  it("searches across groups with plain words, and opens what it finds", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Search sounds"), "kick");
    expect(screen.queryByRole("button", { name: /^Samples/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview RolandTR909 bd" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search sounds"));
    await user.type(screen.getByLabelText("Search sounds"), "zzqq");
    expect(screen.getByText('No sound matches "zzqq".')).toBeInTheDocument();
  });

  it("moves between rows with the arrow keys", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Search sounds"), "flute");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Instruments, 1" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Preview gm_flute" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByLabelText("Search sounds")).toHaveFocus();
  });

  it("puts the sound and its snippet in the drag data", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Synths, 1" }));
    const row = screen.getByRole("button", { name: "Preview sawtooth" }).closest("li");
    if (!row) throw new Error("no row");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), effectAllowed: "" };
    fireEvent.dragStart(row, { dataTransfer });
    expect(data.get("text/plain")).toBe('note("c3").s("sawtooth")');
    expect(JSON.parse(data.get(SOUND_MIME) ?? "{}")).toMatchObject({ kind: "synth", name: "sawtooth" });
  });

  it("names the matched parts on each closed machine when a search hits many machines", async () => {
    const many = buildCatalog(
      Array.from({ length: 8 }, (_, i): RawSound[] => [
        { key: `m${i}_bd`, type: "sample", drum: { machine: `M${i}`, part: "bd" } },
        { key: `m${i}_sd`, type: "sample", drum: { machine: `M${i}`, part: "sd" } },
      ]).flat(),
      [],
    );
    const { user } = setup(many);
    expect(screen.queryByRole("button", { name: /M0/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Search sounds"), "kick");
    const machine = screen.getByRole("button", { name: "M0, bd" });
    expect(machine).toHaveAttribute("aria-expanded", "false");
    await user.clear(screen.getByLabelText("Search sounds"));
    await user.click(screen.getByRole("button", { name: "Drum machines, 8" }));
    expect(screen.getByRole("button", { name: "M0, 2 parts" })).toBeInTheDocument();
  });

  it("names the insert and copy buttons in a tooltip", async () => {
    // jsdom has no ResizeObserver; the tooltip measures its arrow with one.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Synths, 1" }));
    await user.hover(screen.getByRole("button", { name: 'Insert note("c3").s("sawtooth") at cursor' }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Insert at cursor");
    vi.unstubAllGlobals();
  });
});
