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
 * Where the string literal around a position opens (the index of its quote), or null outside a string.
 * Reads from the start: skips comments, and follows quotes and escapes. A template literal
 * counts as a string; its ${} parts are rare in Strudel code and are treated as string too.
 */
export function stringStart(code: string, pos: number): number | null {
  let open: number | null = null;
  for (let i = 0; i < pos && i < code.length; i++) {
    const c = code[i];
    if (open !== null) {
      const quote = code[open];
      if (c === "\\") i++;
      else if (c === quote) open = null;
      else if (c === "\n" && quote !== "`") open = null;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      if (end < 0 || end >= pos) return null;
      i = end;
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end < 0 || end + 2 > pos) return null;
      i = end + 1;
    } else if (c === '"' || c === "'" || c === "`") {
      open = i;
    }
  }
  return open;
}

/** Whether a position is inside a string literal in JavaScript code. */
export const isInsideString = (code: string, pos: number) => stringStart(code, pos) !== null;

/** The function a string is the first argument of: "s" for s("bd") or .s("bd"), or null. */
function callOf(code: string, quote: number): string | null {
  let i = quote - 1;
  while (i >= 0 && /\s/.test(code[i] ?? "")) i--;
  if (code[i] !== "(") return null;
  i--;
  while (i >= 0 && /\s/.test(code[i] ?? "")) i--;
  const end = i + 1;
  while (i >= 0 && /[\w$]/.test(code[i] ?? "")) i--;
  return end > i + 1 ? code.slice(i + 1, end) : null;
}

/** Strings where a sound name belongs. A name dropped in note("c3") or .bank("x") would break the code. */
const SOUND_CALLS = new Set(["s", "sound", "n"]);

/** A line that starts a labelled pattern: "$: s(...)", "drums: s(...)", "_$: ..." (muted). */
const LABEL = /^[ \t]*[A-Za-z_$][\w$]*:/m;

/**
 * The prefix for a snippet on a new line. When the code uses $: patterns, Strudel plays only
 * those and ignores a bare expression, so the snippet needs its own "$: ". The same holds in empty code.
 */
const newLinePrefix = (code: string) => (code.trim() === "" || LABEL.test(code) ? "$: " : "");

/** The prefix for a snippet at a position: only on an otherwise blank line. */
function linePrefix(code: string, from: number): string {
  const start = code.lastIndexOf("\n", from - 1) + 1;
  let end = code.indexOf("\n", from);
  if (end < 0) end = code.length;
  return code.slice(start, end).trim() === "" ? newLinePrefix(code) : "";
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
 * What to insert for a sound at a position. Inside an s(), sound() or n() string: only the name
 * ("bd" for a drum part; .bank stays the user's choice), with a space added where it would touch
 * another word. Outside a string: the full snippet, with "$: " on a blank line when the code uses
 * $: patterns. Inside any other string: the full snippet on a new line under the current one.
 */
export function insertionFor(code: string, pos: number, item: SoundItem): Insertion {
  return insertionForAll(code, pos, [item]);
}

/** Lines of full snippets at a position, or below the current line when the position is inside a string. */
function snippetLines(code: string, at: number, items: SoundItem[], inString: boolean): Insertion {
  if (!inString) {
    const prefix = linePrefix(code, at);
    return { from: at, text: items.map((i) => prefix + fullSnippet(i)).join("\n") };
  }
  let end = code.indexOf("\n", at);
  if (end < 0) end = code.length;
  const prefix = newLinePrefix(code);
  return { from: end, text: items.map((i) => `\n${prefix}${fullSnippet(i)}`).join("") };
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

/** Several sounds at one position (files dropped together): spaces inside a pattern, new lines outside. */
export function insertionForAll(code: string, pos: number, items: SoundItem[]): Insertion {
  const at = Math.max(0, Math.min(pos, code.length));
  const quote = stringStart(code, at);
  if (quote !== null && SOUND_CALLS.has(callOf(code, quote) ?? "")) {
    return nameInString(code, at, items.map((i) => i.name).join(" "));
  }
  return snippetLines(code, at, items, quote !== null);
}
