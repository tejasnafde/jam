import type { SoundItem } from "./catalog";

/** Synths that make noise or a drum hit: a note does nothing for them, so the snippet is s() alone. */
const UNPITCHED = new Set(["white", "pink", "brown", "crackle", "sbd", "z_noise", "bytebeat"]);

/** Whether a sound plays a pitch, so its snippet and its preview carry a note. */
export const isPitched = (item: SoundItem) =>
  item.kind === "instrument" || (item.kind === "synth" && !UNPITCHED.has(item.name));

/** The full line for a sound, used outside a string and by the copy button. */
export function fullSnippet(item: SoundItem): string {
  if (item.kind === "drum" && item.machine) return `s("${item.name}").bank("${item.machine}")`;
  if (isPitched(item)) return `note("c3").s("${item.name}")`;
  return `s("${item.name}")`;
}

/**
 * Whether a position is inside a string literal (a mini-notation pattern) in JavaScript code.
 * Reads from the start: skips comments, and follows quotes and escapes. A template literal
 * counts as a string; its ${} parts are rare in Strudel code and are treated as string too.
 */
export function isInsideString(code: string, pos: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < pos && i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      else if (c === "\n" && quote !== "`") quote = null;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      if (end < 0 || end >= pos) return false;
      i = end;
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end < 0 || end + 2 > pos) return false;
      i = end + 1;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    }
  }
  return quote !== null;
}

// Inside a pattern, no space is needed next to a quote or a bracket that opens or closes a group.
const OPEN = new Set(['"', "'", "`", "[", "<", "{", "(", " ", "\t", "\n", ","]);
const CLOSE = new Set(['"', "'", "`", "]", ">", "}", ")", " ", "\t", "\n", ","]);

export interface Insertion {
  /** Where the text goes. */
  from: number;
  text: string;
}

/**
 * What to insert for a sound at a position. Inside a string: only the name ("bd" for a drum part;
 * .bank stays the user's choice), with a space added where it would touch another word.
 * Outside a string: the full snippet.
 */
export function insertionFor(code: string, pos: number, item: SoundItem): Insertion {
  const at = Math.max(0, Math.min(pos, code.length));
  if (!isInsideString(code, at)) return { from: at, text: fullSnippet(item) };
  return nameInString(code, at, item.name);
}

/**
 * A name inside a pattern. A drop in the middle of a step ("bd*|2") moves to the end of that step,
 * so "bd*2" stays whole; then a space goes wherever the name would touch another step.
 */
function nameInString(code: string, pos: number, name: string): Insertion {
  let at = pos;
  if (at > 0 && !OPEN.has(code[at - 1] ?? "")) {
    while (at < code.length && !CLOSE.has(code[at] ?? "")) at++;
  }
  const before = code[at - 1];
  const after = code[at];
  let text = name;
  if (before !== undefined && !OPEN.has(before)) text = ` ${text}`;
  if (after !== undefined && !CLOSE.has(after)) text = `${text} `;
  return { from: at, text };
}

/** Several sounds at one position (files dropped together): spaces inside a string, new lines outside. */
export function insertionForAll(code: string, pos: number, items: SoundItem[]): Insertion {
  const at = Math.max(0, Math.min(pos, code.length));
  const [first] = items;
  if (items.length === 1 && first) return insertionFor(code, at, first);
  const inside = isInsideString(code, at);
  const joined = inside ? items.map((i) => i.name).join(" ") : items.map(fullSnippet).join("\n");
  if (!inside) return { from: at, text: joined };
  return nameInString(code, at, joined);
}
