import { aliasTargets, DRUM_PARTS } from "@jam/shared";

export type SoundKind = "drum" | "sample" | "instrument" | "synth" | "yours";

/** One sound the user can preview, copy, drag or insert. */
export interface SoundItem {
  kind: SoundKind;
  /** What goes in a mini-notation string: "bd" for a drum part, "gm_flute", "casio". */
  name: string;
  /** The key Strudel's sound map knows it by: "rolandtr909_bd", "gm_flute". */
  key: string;
  /** For a drum part: the machine to put in .bank(), "RolandTR909". */
  machine?: string;
  /** How many files the sample has (s("casio:2") picks one). */
  variants?: number;
}

export interface DrumMachine {
  /** The name for .bank(), "RolandTR909". */
  name: string;
  /** The short alias Strudel also accepts, "tr909". */
  alias?: string;
  parts: SoundItem[];
}

export interface Catalog {
  machines: DrumMachine[];
  samples: SoundItem[];
  instruments: SoundItem[];
  synths: SoundItem[];
  yours: SoundItem[];
}

/** One registered sound, normalized from either Strudel's map or the server index. */
export interface RawSound {
  key: string;
  type: "sample" | "soundfont" | "synth";
  variants?: number;
  /** A drum machine part: the machine's name and the part. */
  drum?: { machine: string; part: string };
  /** True when the key is an alias of another key ("tr909_bd" for "rolandtr909_bd"). */
  alias?: string;
}

/** The entry shape in Strudel's soundMap (superdough registerSound data). */
export interface StrudelSoundEntry {
  data?: {
    type?: string;
    samples?: unknown;
    baseUrl?: string;
  };
}

const DRUM_SOURCE = "tidal-drum-machines";

const countOf = (samples: unknown) =>
  Array.isArray(samples)
    ? samples.length
    : samples && typeof samples === "object"
      ? Object.keys(samples).length
      : undefined;

const firstUrl = (samples: unknown): string | undefined => {
  if (Array.isArray(samples)) return typeof samples[0] === "string" ? samples[0] : undefined;
  if (samples && typeof samples === "object") return firstUrl(Object.values(samples)[0]);
  return undefined;
};

/**
 * Reads Strudel's sound map. A drum machine key "rolandtr909_bd" is lower case in the map; the machine's
 * real name ("RolandTR909") is the first folder of its sample URL. A key whose bank differs from that
 * folder is an alias Strudel added with aliasBank ("tr909_bd").
 */
export function fromSoundMap(map: Record<string, StrudelSoundEntry | undefined>): RawSound[] {
  const out: RawSound[] = [];
  for (const [key, entry] of Object.entries(map)) {
    const data = entry?.data;
    const type = data?.type;
    if (type === "synth" || type === "soundfont") {
      out.push({ key, type });
      continue;
    }
    if (type !== "sample") continue;
    const variants = countOf(data?.samples);
    // A deleted library sample is registered as an empty list, so it stays silent.
    if (!variants) continue;
    const base = data?.baseUrl ?? "";
    const cut = key.indexOf("_");
    if (base.includes(DRUM_SOURCE) && cut > 0) {
      const url = firstUrl(data?.samples) ?? "";
      const folder = (url.startsWith(base) ? url.slice(base.length) : "").split("/")[0] ?? "";
      const bank = key.slice(0, cut);
      const part = key.slice(cut + 1);
      const machine = folder || bank;
      const alias = folder && folder.toLowerCase() !== bank ? bank : undefined;
      out.push({ key, type, variants, drum: { machine, part }, alias });
      continue;
    }
    out.push({ key, type, variants });
  }
  return out;
}

/** The server's lookup_sound entries (the fallback when Strudel's map is out of reach). */
export interface IndexEntry {
  name: string;
  kind: "synth" | "soundfont" | "sample" | "drum-machine";
  variants?: number;
  usage: string;
}

export function fromIndex(entries: IndexEntry[]): RawSound[] {
  return entries.map((e): RawSound => {
    if (e.kind === "drum-machine") {
      const cut = e.name.lastIndexOf("_");
      const machine = e.name.slice(0, cut);
      const part = e.name.slice(cut + 1);
      return { key: e.name.toLowerCase(), type: "sample", variants: e.variants, drum: { machine, part } };
    }
    return { key: e.name, type: e.kind === "sample" ? "sample" : e.kind, variants: e.variants };
  });
}

const PART_ORDER = Object.keys(DRUM_PARTS);
const partRank = (p: string) => {
  const i = PART_ORDER.indexOf(p);
  return i < 0 ? PART_ORDER.length : i;
};
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Groups raw sounds for the browser. The user's own sample names go to "Yours", not "Samples". */
export function buildCatalog(raw: RawSound[], yours: readonly string[]): Catalog {
  const own = new Set(yours.map((n) => n.toLowerCase()));
  const machines = new Map<string, DrumMachine>();
  const aliases = new Map<string, string>();
  const samples: SoundItem[] = [];
  const instruments: SoundItem[] = [];
  const synths: SoundItem[] = [];

  for (const r of raw) {
    if (r.drum) {
      const id = r.drum.machine.toLowerCase();
      if (r.alias) {
        aliases.set(id, r.alias);
        continue;
      }
      const { part } = r.drum;
      // The tidal set has one key with an empty part ("..._"); it cannot be written as s("").
      if (!part) continue;
      let m = machines.get(id);
      if (!m) machines.set(id, (m = { name: r.drum.machine, parts: [] }));
      m.parts.push({ kind: "drum", name: part, key: r.key, machine: r.drum.machine, variants: r.variants });
    } else if (r.type === "soundfont") {
      instruments.push({ kind: "instrument", name: r.key, key: r.key });
    } else if (r.type === "synth") {
      synths.push({ kind: "synth", name: r.key, key: r.key });
    } else if (!own.has(r.key)) {
      samples.push({ kind: "sample", name: r.key, key: r.key, variants: r.variants });
    }
  }

  for (const [id, alias] of aliases) {
    const m = machines.get(id);
    if (m) m.alias = alias;
  }
  const list = [...machines.values()].sort(byName);
  for (const m of list) m.parts.sort((a, b) => partRank(a.name) - partRank(b.name) || byName(a, b));

  return {
    machines: list,
    samples: samples.sort(byName),
    instruments: instruments.sort(byName),
    synths: synths.sort(byName),
    yours: [...yours].sort().map((name) => ({ kind: "yours", name, key: name.toLowerCase() })),
  };
}

/** The total number of rows a catalog can show: every drum part, sample, instrument and synth. */
export function soundCount(c: Catalog): number {
  const parts = c.machines.reduce((n, m) => n + m.parts.length, 0);
  return parts + c.samples.length + c.instruments.length + c.synths.length + c.yours.length;
}

/**
 * Filters every group by one query. A machine stays whole when its name or alias matches,
 * and keeps only the matching parts otherwise. Plain words work: "kick" finds bd, "hat" hh and oh.
 */
export function searchCatalog(c: Catalog, query: string): Catalog {
  const q = query.trim().toLowerCase();
  if (!q) return c;
  const targets = aliasTargets(q);
  const matches = (name: string) => {
    const n = name.toLowerCase();
    return n.includes(q) || targets.some((t) => n === t || (t.length >= 2 && n.includes(t)));
  };
  const partMatches = (part: string) => {
    const n = part.toLowerCase();
    return n.startsWith(q) || targets.includes(n) || (DRUM_PARTS[n]?.startsWith(q) ?? false);
  };

  const machines: DrumMachine[] = [];
  for (const m of c.machines) {
    if (m.name.toLowerCase().includes(q) || m.alias?.toLowerCase().includes(q)) {
      machines.push(m);
      continue;
    }
    const parts = m.parts.filter((p) => partMatches(p.name));
    if (parts.length) machines.push({ ...m, parts });
  }
  return {
    machines,
    samples: c.samples.filter((s) => matches(s.name)),
    instruments: c.instruments.filter((s) => matches(s.name)),
    synths: c.synths.filter((s) => matches(s.name)),
    yours: c.yours.filter((s) => matches(s.name)),
  };
}
