/** The parts of the editor that Share needs to play the code of the session the page shows. */
export interface CodePlayer {
  /** The code Strudel evaluated last, or null before Strudel loads. */
  getActiveCode(): string | null;
  /** Evaluates without starting playback. */
  evaluateQuiet(code: string): Promise<void>;
}

/**
 * Makes `code` the pattern Strudel plays, so a recording is the session the dialog shows and not
 * a pattern left from another session. False when it does not evaluate.
 */
export async function evaluateShown(player: CodePlayer | null, code: string): Promise<boolean> {
  if (!player) return false;
  if (player.getActiveCode() === code) return true;
  await player.evaluateQuiet(code);
  return player.getActiveCode() === code;
}
