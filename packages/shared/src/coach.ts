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

/** A taken event with no coach note this long after the take goes back to the coach (a lost answer). */
export const COACH_LEASE_MS = 60_000;
/** How many times one event goes to a coach before the server gives up on it. */
export const COACH_MAX_TAKES = 3;
/** A pending check-in older than this is dropped, not delivered: it no longer describes the music. */
export const COACH_CHECKIN_STALE_MS = 10 * 60_000;
/** The page is "away" when its coach poll has not come for this long. A waiting coach then stops. */
export const COACH_PAGE_AWAY_MS = 3 * 60_000;
/** The page's coach poll records pageSeenAt at most this often. */
export const COACH_PAGE_SEEN_WRITE_MS = 60_000;

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
  /**
   * Asks and check-ins wait as "pending" until a coach takes them. A coach note in the session
   * makes the taken ones "done" (so does giving up after COACH_MAX_TAKES). Notes have none.
   */
  status: z.enum(["pending", "taken", "done"]).nullable(),
  takenAt: z.string().nullable().optional(),
  /** How many times a coach took it. */
  takes: z.number().int().optional(),
  /** Check-ins only: what made it due. */
  reason: z.enum(["runs", "minutes"]).optional(),
});
export type CoachEvent = z.infer<typeof coachEventSchema>;

export const coachThreadSchema = z.object({
  events: z.array(coachEventSchema),
  cadence: coachCadenceSchema,
  /** When a coach last waited for this user, or null. */
  listeningAt: z.string().nullable(),
  /** When the thread last changed (an event added, taken, answered or dropped), or null. */
  updatedAt: z.string().nullable(),
});
export type CoachThread = z.infer<typeof coachThreadSchema>;

/** What the page polls: it reads the whole thread only when updatedAt moves. */
export const coachStatusSchema = coachThreadSchema.pick({ listeningAt: true, updatedAt: true });
export type CoachStatus = z.infer<typeof coachStatusSchema>;

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

/**
 * What a waiting coach does with a session's open events (pending, or taken and not answered) at
 * time `at`: drop stale pending check-ins, give up on events taken COACH_MAX_TAKES times, and take
 * the next one. Asks go before check-ins, older before newer. A taken event comes back after
 * COACH_LEASE_MS. `open` tells if the session still has open events afterwards.
 */
export function pickCoachEvent(
  events: readonly CoachEvent[],
  at: number,
): { take: CoachEvent | null; drop: string[]; giveUp: string[]; open: boolean } {
  const drop: string[] = [];
  const giveUp: string[] = [];
  const ready: CoachEvent[] = [];
  let open = false;
  for (const e of events) {
    if (e.status === "pending") {
      if (e.kind === "checkin" && at - Date.parse(e.createdAt) >= COACH_CHECKIN_STALE_MS) {
        drop.push(e.id);
        continue;
      }
      ready.push(e);
    } else if (e.status === "taken") {
      const leaseOver = !e.takenAt || at - Date.parse(e.takenAt) >= COACH_LEASE_MS;
      if (leaseOver && (e.takes ?? 1) >= COACH_MAX_TAKES) {
        giveUp.push(e.id);
        continue;
      }
      if (leaseOver) ready.push(e);
    } else continue;
    open = true;
  }
  const rank = (e: CoachEvent) => (e.kind === "ask" ? 0 : 1);
  ready.sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
  return { take: ready[0] ?? null, drop, giveUp, open };
}

/** True when the page has not polled the coach thread within COACH_PAGE_AWAY_MS of `now`, or never. */
export function isPageAway(pageSeenAt: string | null | undefined, now: number): boolean {
  return !pageSeenAt || now - Date.parse(pageSeenAt) >= COACH_PAGE_AWAY_MS;
}

/** True when a coach waited within COACH_LISTENING_MS of `now`. */
export function isListening(listeningAt: string | null | undefined, now: number): boolean {
  return !!listeningAt && now - Date.parse(listeningAt) < COACH_LISTENING_MS;
}
