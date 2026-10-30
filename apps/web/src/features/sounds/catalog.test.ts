import { describe, expect, it } from "vitest";
import { buildCatalog, fromIndex, fromSoundMap, searchCatalog, soundCount, type StrudelSoundEntry } from "./catalog";

const TDM = "https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/";
const DIRT = "https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/";
const drum = (path: string, n = 1): StrudelSoundEntry => ({
  data: { type: "sample", baseUrl: TDM, samples: Array.from({ length: n }, (_, i) => `${TDM}${path}/${i}.wav`) },
});
const tr909bd = drum("RolandTR909/rolandtr909-bd", 2);

/** A sound map shaped like the one Strudel builds in its prebake, after aliasBank. */
const FAKE_MAP: Record<string, StrudelSoundEntry> = {
  rolandtr909_bd: tr909bd,
  rolandtr909_sd: drum("RolandTR909/rolandtr909-sd"),
  rolandtr909_hh: drum("RolandTR909/rolandtr909-hh"),
  tr909_bd: tr909bd, // alias added by aliasBank: same entry
  akailinn_cp: drum("AkaiLinn/akailinn-cp"),
  rolandtr909_: drum("RolandTR909/rolandtr909-"),
  bd: { data: { type: "sample", baseUrl: DIRT, samples: [`${DIRT}bd/1.wav`, `${DIRT}bd/2.wav`] } },
  casio: { data: { type: "sample", baseUrl: DIRT, samples: [`${DIRT}casio/1.wav`] } },
  piano: { data: { type: "sample", baseUrl: DIRT, samples: { a0: [`${DIRT}a.mp3`], c4: [`${DIRT}c.mp3`] } } },
  gm_flute: { data: { type: "soundfont" } },
  gm_piano: { data: { type: "soundfont" } },
  sawtooth: { data: { type: "synth" } },
  white: { data: { type: "synth" } },
  mic: { data: { type: "input" } },
  my_loop: { data: { type: "sample", samples: ["https://storage.example/my_loop.wav"] } },
  gone: { data: { type: "sample", samples: [] } }, // a deleted library sample
};

const catalog = () => buildCatalog(fromSoundMap(FAKE_MAP), ["my_loop"]);

describe("building groups from Strudel's sound map", () => {
  it("groups drum machines by their real name, with their parts in a beginner's order", () => {
    const { machines } = catalog();
    expect(machines.map((m) => m.name)).toEqual(["AkaiLinn", "RolandTR909"]);
    const tr909 = machines[1];
    expect(tr909?.alias).toBe("tr909");
    expect(tr909?.parts.map((p) => p.name)).toEqual(["bd", "sd", "hh"]);
    expect(tr909?.parts[0]).toMatchObject({ kind: "drum", key: "rolandtr909_bd", machine: "RolandTR909", variants: 2 });
  });

  it("sorts samples, instruments, synths and the user's own samples into their groups", () => {
    const c = catalog();
    expect(c.samples.map((s) => s.name)).toEqual(["bd", "casio", "piano"]);
    expect(c.samples.find((s) => s.name === "piano")?.variants).toBe(2);
    expect(c.instruments.map((s) => s.name)).toEqual(["gm_flute", "gm_piano"]);
    expect(c.synths.map((s) => s.name)).toEqual(["sawtooth", "white"]);
    expect(c.yours).toEqual([{ kind: "yours", name: "my_loop", key: "my_loop" }]);
    expect(soundCount(c)).toBe(4 + 3 + 2 + 2 + 1);
  });

  it("reads the server index the same way when Strudel's map is out of reach", () => {
    const c = buildCatalog(
      fromIndex([
        { name: "RolandTR808_bd", kind: "drum-machine", variants: 2, usage: 's("bd").bank("TR808")' },
        { name: "casio", kind: "sample", usage: 's("casio")' },
        { name: "gm_flute", kind: "soundfont", usage: 's("gm_flute")' },
        { name: "sine", kind: "synth", usage: 's("sine")' },
      ]),
      [],
    );
    expect(c.machines[0]).toMatchObject({ name: "RolandTR808", parts: [{ name: "bd", key: "rolandtr808_bd" }] });
    expect([c.samples.length, c.instruments.length, c.synths.length]).toEqual([1, 1, 1]);
  });
});

describe("search", () => {
  it("finds by name across groups", () => {
    const found = searchCatalog(catalog(), "pian");
    expect(found.samples.map((s) => s.name)).toEqual(["piano"]);
    expect(found.instruments.map((s) => s.name)).toEqual(["gm_piano"]);
    expect(found.machines).toEqual([]);
  });

  it("keeps a whole machine when its name or alias matches", () => {
    expect(searchCatalog(catalog(), "909").machines[0]?.parts).toHaveLength(3);
    expect(searchCatalog(catalog(), "tr909").machines.map((m) => m.name)).toEqual(["RolandTR909"]);
  });

  it("understands plain words: kick, snare, hat, clap", () => {
    const kick = searchCatalog(catalog(), "kick");
    expect(kick.machines.map((m) => [m.name, m.parts.map((p) => p.name)])).toEqual([["RolandTR909", ["bd"]]]);
    expect(kick.samples.map((s) => s.name)).toEqual(["bd"]);
    expect(searchCatalog(catalog(), "snare").machines[0]?.parts.map((p) => p.name)).toEqual(["sd"]);
    expect(searchCatalog(catalog(), "hat").machines[0]?.parts.map((p) => p.name)).toEqual(["hh"]);
    expect(searchCatalog(catalog(), "clap").machines.map((m) => m.name)).toEqual(["AkaiLinn"]);
  });

  it("returns the catalog itself for an empty query, and nothing for a miss", () => {
    const c = catalog();
    expect(searchCatalog(c, "  ")).toBe(c);
    expect(soundCount(searchCatalog(c, "zzqq"))).toBe(0);
  });
});
