// Fixture data for the dev-only ?preview mode (layout screenshots). Never bundled in production.
import type { CoachEvent, CoachThread, SampleWithUrl, Session, VersionEntry } from "@jam/shared";
import type { CoachHandle } from "./features/coach/useCoach";
import type { SessionsHandle } from "./features/sessions/useSessions";
import type { PanelOverride } from "./App";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const session = (id: string, name: string, versionCount: number, minutes: number): Session => ({
  id,
  name,
  createdAt: ago(minutes + 600),
  updatedAt: ago(minutes),
  lastCode: "",
  versionCount,
  planId: null,
});

const VERSION_LINES = [
  '$: s("hh*8").gain(.4).degradeBy(.3)',
  'note("<c3 eb3 g3 bb3>").s("gm_epiano1").room(.4)',
  "removed: .lpf(700)",
  's("bd ~ ~ bd, ~ sd").bank("RolandTR909").swingBy(1/3, 4)',
  "setcpm(84/4)",
  '$: note("<c2 eb2 g1 bb1>").s("sawtooth").lpf(500)',
];

const versions: VersionEntry[] = Array.from({ length: 24 }, (_, i) => ({
  id: `v${i}`,
  code: `setcpm(84/4)\n\n$: s("bd ~ ~ bd, ~ sd").bank("RolandTR909")\n\n${VERSION_LINES[i % VERSION_LINES.length]}\n`,
  createdAt: ago(4 + i * 7),
  evaluatedAt: ago(4 + i * 7),
  evalCount: 1,
  summary: VERSION_LINES[i % VERSION_LINES.length] as string,
}));

const noop = async () => {};

export const PREVIEW_SESSIONS: SessionsHandle = {
  sessions: [
    session("s1", "Rainy lofi loop", 24, 4),
    session("s2", "Night drive, slower", 9, 60 * 26),
    session("untitled", "Untitled", 3, 60 * 24 * 6),
  ],
  currentId: "s1",
  create: noop,
  open: noop,
  rename: noop,
  duplicate: noop,
  remove: noop,
  restore: noop,
  loadVersions: async (_id, before) => {
    const start = before ? versions.findIndex((v) => v.createdAt === before) + 1 : 0;
    const page = versions.slice(start, start + 10);
    return { versions: page, nextBefore: start + 10 < versions.length ? (page.at(-1)?.createdAt ?? null) : null };
  },
};

const event = (
  id: string,
  kind: CoachEvent["kind"],
  text: string,
  minutes: number,
  extra: Partial<CoachEvent> = {},
): CoachEvent => ({
  id,
  sessionId: "s1",
  kind,
  text,
  createdAt: ago(minutes),
  status: kind === "note" ? null : "taken",
  ...extra,
});

const THREAD: CoachEvent[] = [
  event("c1", "ask", "", 26),
  event(
    "c2",
    "note",
    "What a lovely lazy kick. The snare sits right on the beat, though. What happens if it leans back a little?",
    25,
  ),
  event("c3", "checkin", "", 14, { reason: "runs" }),
  event(
    "c4",
    "note",
    "That swing on the hats was a happy accident. Keep it. Can you hear room for some rain up high?",
    14,
  ),
  event("c5", "ask", "Why does the bass disappear on my laptop speakers?", 2),
  event(
    "c6",
    "note",
    "Small speakers drop the very low end. Try lifting the bass an octave, or give it a little `.shape`. Which do you like better?",
    1,
  ),
];

/** A coach thread fixture. The handle keeps asks in memory, so the preview responds. */
function previewCoach(events: CoachEvent[], listening: boolean): CoachHandle {
  const thread: CoachThread = {
    events,
    cadence: "runs15",
    listeningAt: listening ? new Date().toISOString() : null,
    updatedAt: null,
  };
  return { thread, ask: noop, setCadence: noop, refresh: noop };
}

/**
 * ?preview=empty: signed in, nothing made yet. ?preview (or ?preview=active): a session in
 * progress with a live coach. ?preview=thread: the same thread, no coach connected.
 */
export function previewPanel(state: string | null): PanelOverride {
  if (state === "thread") return { ...PREVIEW_PANEL, coach: previewCoach(THREAD, false) };
  if (state !== "empty") return PREVIEW_PANEL;
  return {
    ...PREVIEW_PANEL,
    plan: null,
    tokens: [],
    grants: [],
    freshToken: null,
    samples: [],
    prep: { jobs: {}, start: async () => {} },
    sessions: { ...PREVIEW_SESSIONS, sessions: [PREVIEW_SESSIONS.sessions[2] as Session], currentId: "untitled" },
    coach: {
      thread: { events: [], cadence: "ask", listeningAt: null, updatedAt: null },
      ask: noop,
      setCadence: noop,
      refresh: noop,
    },
  };
}

export const PREVIEW_PANEL: PanelOverride = {
  profile: { name: "Tejas", email: "tejas@example.com", photoUrl: null },
  plan: {
    id: "p1",
    destination: "A slow, rainy lofi loop: dusty drums, a warm Rhodes, and a bass that walks home.",
    currentStage: 1,
    note: "That swing on the hats was a happy accident. Keep it.",
    createdAt: "",
    updatedAt: "",
    stages: [
      { title: "Lay the floor", goal: "A kick and snare that feel lazy, not stiff." },
      {
        title: "Add the rain",
        goal: "A soft high texture that never quite repeats.",
        hint: "Look at how degradeBy thins a pattern out.",
      },
      { title: "Bring in the chords", goal: "Four warm chords that loop." },
      { title: "Walk the bass", goal: "A bass that follows the chord roots." },
      { title: "Let it breathe", goal: "Take one layer out every few bars." },
    ],
  },
  tokens: [{ id: "h1", label: "Claude Code", createdAt: "", lastUsedAt: new Date(Date.now() - 180_000).toISOString() }],
  grants: [
    { id: "g1", clientName: "Claude", createdAt: "", lastUsedAt: new Date(Date.now() - 3_600_000).toISOString() },
  ],
  freshToken: "jam_q8Zx2LkP0vR7mNa4tY1sWc9eHd3fGb6uJi5oKl0pXz",
  onSignIn: () => {},
  onSignOut: () => {},
  onCreateToken: () => {},
  onRevokeToken: () => {},
  onRevokeGrant: () => {},
  samples: [
    sample("s1", "rainy_hook", "take", 4.2, { key: "F minor", ops: ["autotune:hard", "reverb"] }),
    sample("s2", "nightdrive", "upload", 212.6, { bpm: 92, key: "A minor" }),
    sample("s3", "nightdrive_vocals", "stem", 212.6, { bpm: 92, key: "A minor", stem: "vocals", parentId: "s2" }),
  ],
  sessions: PREVIEW_SESSIONS,
  coach: previewCoach(THREAD, true),
  uploadingSample: false,
  onUploadSample: () => {},
  onDeleteSample: () => {},
  prep: {
    jobs: {
      s2: { status: "done", jobId: "j1", sampleIds: ["s3", "s4", "s5", "s6"] },
      s3: { status: "running", jobId: "j2" },
    },
    start: async () => {},
  },
};

function sample(
  id: string,
  name: string,
  kind: SampleWithUrl["kind"],
  durationSec: number,
  extra: Partial<SampleWithUrl> = {},
): SampleWithUrl {
  const storagePath = `users/u/samples/${id}.wav`;
  return {
    id,
    userId: "u",
    name,
    kind,
    storagePath,
    contentType: "audio/wav",
    durationSec,
    ops: [],
    createdAt: "",
    url: "",
    ...extra,
  };
}
