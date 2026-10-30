// Index of Strudel's default sound names, for the lookup_sound tool.
//
// The sample maps are the same JSON files the Strudel REPL loads in its
// prebake step. They are fetched once per instance and cached in memory. The
// cache is only a cache: losing it costs one refetch, not user data.

import { aliasTargets } from "@jam/shared";
import gmSounds from "./gm-sounds.json" with { type: "json" };

const DOUGH = "https://raw.githubusercontent.com/felixroos/dough-samples/main";
export const SAMPLE_MAPS: Record<string, string> = {
  "tidal-drum-machines": `${DOUGH}/tidal-drum-machines.json`,
  piano: `${DOUGH}/piano.json`,
  "dirt-samples": `${DOUGH}/Dirt-Samples.json`,
  vcsl: `${DOUGH}/vcsl.json`,
  mridangam: `${DOUGH}/mridangam.json`,
  "uzu-drumkit": "https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json",
};
export const BANK_ALIASES_URL =
  "https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json";

// Built-in synths registered by superdough (synth.mjs, zzfx.mjs).
export const SYNTHS = [
  "sine",
  "triangle",
  "square",
  "sawtooth",
  "supersaw",
  "pulse",
  "sbd",
  "bytebeat",
  "white",
  "pink",
  "brown",
  "crackle",
  "zzfx",
  "z_sine",
  "z_sawtooth",
  "z_triangle",
  "z_square",
  "z_tan",
  "z_noise",
];

export interface SoundEntry {
  name: string;
  kind: "synth" | "soundfont" | "sample" | "drum-machine";
  source: string;
  variants?: number;
  usage: string;
}

export type Fetcher = (url: string) => Promise<unknown>;

const defaultFetcher: Fetcher = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

export class SoundIndex {
  private entries: Promise<SoundEntry[]> | null = null;
  constructor(private fetcher: Fetcher = defaultFetcher) {}

  private load(): Promise<SoundEntry[]> {
    if (!this.entries) {
      this.entries = this.build().catch((err) => {
        this.entries = null; // retry on the next call
        throw err;
      });
    }
    return this.entries;
  }

  private async build(): Promise<SoundEntry[]> {
    const out: SoundEntry[] = [];
    for (const s of SYNTHS) out.push({ name: s, kind: "synth", source: "superdough", usage: `s("${s}")` });
    for (const s of gmSounds as string[]) {
      out.push({ name: s, kind: "soundfont", source: "gm soundfonts", usage: `s("${s}")` });
    }

    const maps = await Promise.allSettled(
      Object.entries(SAMPLE_MAPS).map(async ([source, url]) => ({
        source,
        map: (await this.fetcher(url)) as Record<string, unknown>,
      })),
    );
    let aliases: Record<string, string> = {};
    try {
      aliases = (await this.fetcher(BANK_ALIASES_URL)) as Record<string, string>;
    } catch {
      // Aliases are a nicety; the index works without them.
    }
    const aliasFor = new Map(Object.entries(aliases).map(([full, short]) => [full, short]));

    for (const m of maps) {
      if (m.status !== "fulfilled") continue;
      const { source, map } = m.value;
      for (const [key, val] of Object.entries(map)) {
        if (key.startsWith("_")) continue;
        const variants = Array.isArray(val) ? val.length : val && typeof val === "object" ? Object.keys(val).length : 1;
        if (source === "tidal-drum-machines") {
          const cut = key.lastIndexOf("_");
          const bank = key.slice(0, cut);
          const sound = key.slice(cut + 1);
          const short = aliasFor.get(bank);
          out.push({
            name: key,
            kind: "drum-machine",
            source,
            variants,
            usage: `s("${sound}").bank("${short ?? bank}")`,
          });
        } else {
          out.push({ name: key, kind: "sample", source, variants, usage: `s("${key}")` });
        }
      }
    }
    return out;
  }

  /** Every entry, for the web page's fallback list when it cannot read Strudel's own map. */
  all(): Promise<SoundEntry[]> {
    return this.load();
  }

  /**
   * Case-insensitive substring search. Exact and prefix matches sort first.
   * Plain words match through the shared alias table: "kick" finds bd, "hat" finds hh and oh.
   */
  async search(query: string, limit = 25): Promise<{ total: number; results: SoundEntry[] }> {
    const q = query.trim().toLowerCase();
    const targets = new Set(aliasTargets(q));
    const all = await this.load();
    const partOf = (e: SoundEntry) => (e.kind === "drum-machine" ? e.name.slice(e.name.lastIndexOf("_") + 1) : e.name);
    const aliased = (e: SoundEntry) => targets.has(partOf(e).toLowerCase());
    const hits = all.filter((e) => e.name.toLowerCase().includes(q) || e.usage.toLowerCase().includes(q) || aliased(e));
    const rank = (e: SoundEntry) => {
      const n = e.name.toLowerCase();
      return n === q ? 0 : n.startsWith(q) || targets.has(n) ? 1 : 2;
    };
    hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { total: hits.length, results: hits.slice(0, limit) };
  }
}
