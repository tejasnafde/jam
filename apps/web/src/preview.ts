// Fixture data for the dev-only ?preview mode (layout screenshots). Never bundled in production.
import type { SampleWithUrl } from "@jam/shared";
import type { PanelOverride } from "./App";

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
  freshToken: "jam_q8Zx2LkP0vR7mNa4tY1sWc9eHd3fGb6uJi5oKl0pXz",
  onSignIn: () => {},
  onSignOut: () => {},
  onCreateToken: () => {},
  onRevokeToken: () => {},
  samples: [
    sample("s1", "rainy_hook", "take", 4.2, { key: "F minor", ops: ["autotune:hard", "reverb"] }),
    sample("s2", "nightdrive", "upload", 212.6, { bpm: 92, key: "A minor" }),
    sample("s3", "nightdrive_vocals", "stem", 212.6, { bpm: 92, key: "A minor", stem: "vocals", parentId: "s2" }),
  ],
  uploadingSample: false,
  onUploadSample: () => {},
  onDeleteSample: () => {},
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
