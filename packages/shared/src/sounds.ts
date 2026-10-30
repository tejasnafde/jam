// Plain names for Strudel's short sound names. The web Sounds browser and the
// lookup_sound MCP tool share this table, so "kick" finds bd in both.

/** Drum machine parts, in the order a beginner reaches for them, with a plain name. */
export const DRUM_PARTS: Readonly<Record<string, string>> = {
  bd: "kick",
  sd: "snare",
  hh: "closed hat",
  oh: "open hat",
  cp: "clap",
  rim: "rimshot",
  lt: "low tom",
  mt: "mid tom",
  ht: "high tom",
  cr: "crash",
  rd: "ride",
  cb: "cowbell",
  sh: "shaker",
  tb: "tambourine",
  perc: "percussion",
  misc: "misc",
  fx: "effects",
};

/** Plain words a beginner types, and the short names they mean. */
export const SOUND_ALIASES: Readonly<Record<string, readonly string[]>> = {
  kick: ["bd"],
  "bass drum": ["bd"],
  snare: ["sd"],
  hat: ["hh", "oh"],
  hihat: ["hh", "oh"],
  "hi-hat": ["hh", "oh"],
  clap: ["cp"],
  rimshot: ["rim"],
  tom: ["lt", "mt", "ht"],
  crash: ["cr"],
  ride: ["rd"],
  cymbal: ["cr", "rd"],
  cowbell: ["cb"],
  shaker: ["sh"],
  tambourine: ["tb"],
  percussion: ["perc"],
};

/**
 * The short names a query means: "kick" and "kic" give ["bd"], "hat" gives ["hh", "oh"].
 * A query of fewer than 3 letters matches only a whole word, so "sd" does not grow into aliases.
 */
export function aliasTargets(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = new Set<string>();
  for (const [word, targets] of Object.entries(SOUND_ALIASES)) {
    if (word === q || (q.length >= 3 && word.startsWith(q))) for (const t of targets) out.add(t);
  }
  return [...out];
}
