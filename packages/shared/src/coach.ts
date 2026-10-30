// The coach thread of a session: the user's asks, the server's automatic check-ins and the
// coach's notes, in one list. A live coach (an MCP client in a wait_for_change loop) takes
// asks and check-ins one at a time and answers them with notes.
import { z } from "zod";

/** When the server adds a check-in on its own. "ask" never does: only the user asks. */
export const COACH_CADENCES = ["ask", "runs15", "minutes10"] as const;
export const coachCadenceSchema = z.enum(COACH_CADENCES);
export type CoachCadence = z.infer<typeof coachCadenceSchema>;

export const COACH_CADENCE_LABELS: Readonly<Record<CoachCadence, string>> = {
  ask: "Only when I ask",
  runs15: "Every 15 runs",
  minutes10: "Every 10 minutes while I play",
};

/** Runs between check-ins for "runs15", and minutes for "minutes10". */
export const COACH_EVERY_RUNS = 15;
export const COACH_EVERY_MS = 10 * 60_000;

/** A coach is "listening" when a wait_for_change call was open this recently. */
export const COACH_LISTENING_MS = 2 * 60_000;

/** The longest ask and the longest coach note, in characters. */
export const COACH_ASK_MAX = 600;
export const COACH_NOTE_MAX = 600;

/** Events of a session's thread the page reads, newest last. */
export const COACH_THREAD_MAX = 50;

/**
 * ask: from the user on the page (empty text means "check my music").
 * checkin: added by the server when the cadence is due.
 * note: the coach's answer, written with the say tool.
 */
export const coachEventKindSchema = z.enum(["ask", "checkin", "note"]);
export type CoachEventKind = z.infer<typeof coachEventKindSchema>;

export const coachEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: coachEventKindSchema,
  text: z.string(),
  createdAt: z.string(),
  /** Asks and check-ins wait as "pending" until a coach takes them. Notes have none. */
  status: z.enum(["pending", "taken"]).nullable(),
  takenAt: z.string().nullable().optional(),
  /** Check-ins only: what made it due. */
  reason: z.enum(["runs", "minutes"]).optional(),
});
export type CoachEvent = z.infer<typeof coachEventSchema>;

export const coachThreadSchema = z.object({
  events: z.array(coachEventSchema),
  cadence: coachCadenceSchema,
  /** When a coach last waited for this user, or null. */
  listeningAt: z.string().nullable(),
});
export type CoachThread = z.infer<typeof coachThreadSchema>;

export const askCoachRequestSchema = z.object({
  text: z.string().trim().max(COACH_ASK_MAX).default(""),
});
export type AskCoachRequest = z.input<typeof askCoachRequestSchema>;

export const setCadenceRequestSchema = z.object({ cadence: coachCadenceSchema });
export type SetCadenceRequest = z.infer<typeof setCadenceRequestSchema>;

/** Cadence bookkeeping, kept on the session document. */
export interface CoachCadenceState {
  cadence: CoachCadence;
  /** Runs since the last check-in (or since the cadence was set). */
  runs: number;
  /** The start of the current window: the first run after the last check-in. Null before that run. */
  since: string | null;
}

export const DEFAULT_CADENCE_STATE: CoachCadenceState = { cadence: "ask", runs: 0, since: null };

/**
 * Moves the cadence on by one run (run: true) or only checks the clock (run: false), at time `at`.
 * Returns the new state and why a check-in is due, or null. A due check-in starts a new window.
 */
export function advanceCadence(
  state: CoachCadenceState,
  at: number,
  run: boolean,
): { state: CoachCadenceState; due: "runs" | "minutes" | null } {
  if (state.cadence === "ask") return { state, due: null };
  let { runs, since } = state;
  if (run) {
    // The first run after a check-in opens the window, so a pause in playing never fires one.
    if (runs === 0 || since === null) since = new Date(at).toISOString();
    runs += 1;
  }
  const due =
    state.cadence === "runs15"
      ? runs >= COACH_EVERY_RUNS
        ? "runs"
        : null
      : runs > 0 && since !== null && at - Date.parse(since) >= COACH_EVERY_MS
        ? "minutes"
        : null;
  if (due) return { state: { cadence: state.cadence, runs: 0, since: null }, due };
  return { state: { cadence: state.cadence, runs, since }, due: null };
}

/** True when a coach waited within COACH_LISTENING_MS of `now`. */
export function isListening(listeningAt: string | null | undefined, now: number): boolean {
  return !!listeningAt && now - Date.parse(listeningAt) < COACH_LISTENING_MS;
}
