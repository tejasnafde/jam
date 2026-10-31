// How long one pass of the playing pattern is, in bars (1 cycle = 1 bar). A heuristic:
// an arrange(...) is the sum of its cycle counts; otherwise the longest <...> sequence wins.
import { SHARE_LIMITS } from "@jam/shared";

export const DEFAULT_BARS = 8;

export interface PlayGuess {
  /** What plays, for the dialog, e.g. "$: intro". */
  label: string;
  bars: number;
  source: "arrange" | "sequence" | "default";
}

export const clampBars = (n: number) =>
  Math.min(SHARE_LIMITS.barsMax, Math.max(SHARE_LIMITS.barsMin, Math.round(n) || DEFAULT_BARS));

const OPEN = "([{<";
const CLOSE = ")]}>";

/** Blanks out comments (keeping line breaks), so commented-out `$:` lines and sequences do not count. */
export function stripComments(code: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i] as string;
    if (quote) {
      out += c;
      if (c === "\\") out += code[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
    } else if (c === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end < 0 ? code.length : end + 2;
      out += code.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else out += c;
  }
  return out;
}

/**
 * One JS expression from `from`: it runs over line breaks while brackets are open or the next
 * line goes on with a method call (`.gain(...)`), and stops at a `;` or the end of the statement.
 */
export function readExpression(code: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  let i = from;
  for (; i < code.length; i++) {
    const c = code[i] as string;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth <= 0 && c === ";") break;
    else if (depth <= 0 && c === "\n" && !/^\s*\./.test(code.slice(i + 1))) break;
  }
  return code.slice(from, i).trim();
}

/** The expressions after each active `$:` (the ones that play). */
export function activePlays(code: string): string[] {
  const clean = stripComments(code);
  const plays: string[] = [];
  for (const m of clean.matchAll(/^[ \t]*\$:/gm)) plays.push(readExpression(clean, (m.index ?? 0) + m[0].length));
  return plays.filter(Boolean);
}

/** The text an identifier was defined with (`const intro = ...`), or null. */
function definition(code: string, name: string): string | null {
  const m = new RegExp(`(?:^|[;\\s])(?:const|let|var)\\s+${name.replace(/\$/g, "\\$")}\\s*=\\s*`).exec(code);
  return m ? readExpression(code, m.index + m[0].length) : null;
}

/** Follows a bare identifier to its definition, a few steps deep. */
function resolve(code: string, expr: string): string {
  let current = expr;
  for (let step = 0; step < 5 && /^[A-Za-z_$][\w$]*$/.test(current); step++) {
    const def = definition(code, current);
    if (!def) break;
    current = def;
  }
  return current;
}

/** The sum of the cycle counts in arrange([n, x], [m, y], ...), or null when the expression is no arrange. */
export function arrangeCycles(expr: string): number | null {
  const m = /^arrange\s*\(/.exec(expr.trim());
  if (!m) return null;
  const body = expr.trim().slice(m[0].length);
  let depth = 0;
  let total = 0;
  let found = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (c === "[") {
      if (depth === 0) {
        const n = /^\[\s*(\d+(?:\.\d+)?)\s*,/.exec(body.slice(i));
        if (n) {
          total += Number(n[1]);
          found = true;
        }
      }
      depth++;
    } else if (c === "]") depth--;
  }
  return found ? total : null;
}

/** Splits at top-level whitespace (and commas, into groups), outside any bracket. */
function topLevel(text: string): string[][] {
  const groups: string[][] = [[]];
  let depth = 0;
  let token = "";
  const push = () => {
    if (token) groups.at(-1)?.push(token);
    token = "";
  };
  for (const c of text) {
    if (OPEN.includes(c)) depth++;
    if (CLOSE.includes(c)) depth--;
    if (depth === 0 && /\s/.test(c)) push();
    else if (depth === 0 && c === ",") {
      push();
      groups.push([]);
    } else token += c;
  }
  push();
  return groups;
}

/** How many steps (cycles) a `<...>` body takes: `x!n` and `x@n` count n, a bare `!` repeats once. */
export function sequenceLength(body: string): number {
  const lengths = topLevel(body).map((tokens) =>
    tokens.reduce((sum, token) => {
      if (token === "!" || token === "_") return sum + 1;
      const rep = /[!@](\d+(?:\.\d+)?)$/.exec(token);
      if (rep) return sum + Number(rep[1]);
      const bangs = /!+$/.exec(token);
      return sum + 1 + (bangs ? bangs[0].length : 0);
    }, 0),
  );
  return Math.max(0, ...lengths);
}

/** The length of the longest `<...>` sequence inside the code's mini-notation strings ("..." and `...`). */
export function longestSequence(code: string): number {
  let best = 0;
  for (const m of code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)) {
    const text = m[1] ?? m[2] ?? "";
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "<") continue;
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (OPEN.includes(text[j] as string)) depth++;
        if (CLOSE.includes(text[j] as string)) depth--;
        if (depth === 0) break;
      }
      if (depth === 0) best = Math.max(best, sequenceLength(text.slice(i + 1, j)));
    }
  }
  return best;
}

const clip = (text: string, max = 32) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Guesses one pass of what plays: the longest of the active `$:` patterns. */
export function guessPlay(code: string): PlayGuess {
  const clean = stripComments(code);
  const plays = activePlays(code);
  const first = plays[0]?.split("\n")[0]?.trim();
  const label = first
    ? `$: ${clip(first)}${plays.length > 1 ? ` + ${plays.length - 1} more` : ""}`
    : clip(clean.trim().split("\n")[0]?.trim() ?? "");
  let arranged = 0;
  let sequence = 0;
  for (const play of plays.length ? plays : [clean]) {
    const expr = resolve(clean, play);
    const cycles = arrangeCycles(expr);
    if (cycles !== null) arranged = Math.max(arranged, cycles);
    else sequence = Math.max(sequence, longestSequence(expr));
  }
  if (arranged > 0 && arranged >= sequence) return { label, bars: clampBars(arranged), source: "arrange" };
  if (!sequence) sequence = longestSequence(clean);
  if (sequence > 0) return { label, bars: clampBars(sequence), source: "sequence" };
  return { label, bars: DEFAULT_BARS, source: "default" };
}

/** Seconds for a number of bars at a tempo in cycles per second. */
export const barsToSeconds = (bars: number, cps: number) => bars / (cps > 0 ? cps : 0.5);

/** The most bars that fit in the longest share at this tempo. */
export const maxBarsAt = (cps: number) =>
  Math.max(
    SHARE_LIMITS.barsMin,
    Math.min(SHARE_LIMITS.barsMax, Math.floor(SHARE_LIMITS.maxSeconds * (cps > 0 ? cps : 0.5))),
  );
