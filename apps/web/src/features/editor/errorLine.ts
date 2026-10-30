/**
 * The line an error points at, when it says: "at line 5", "line 5:", or the parser's "(5:12)".
 * Null when the message has no line.
 */
export function errorLine(message: string): number | null {
  const m = /\bline (\d+)/i.exec(message) ?? /\((\d+):\d+\)/.exec(message);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
