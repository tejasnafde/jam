import { useCallback, useRef } from "react";
import { track } from "@/lib/analytics";
import { ApiError, type Api } from "@/lib/api";
import { measure } from "@/lib/audio";

// One play_started per page load, not one per Ctrl+Enter.
let playStarted = false;

const SETTLE_MS = 1000;
const WINDOW_MS = 3000;

export type SaveStatus = "idle" | "saving" | "saved" | "failed" | "signed-out";

/**
 * Saves each successful evaluation, then measures a few seconds of sound and
 * stores that as the version's audio snapshot. A newer evaluation cancels the
 * pending measurement of an older one.
 */
export function useEvaluationRecorder(
  api: Api | null,
  isPlaying: () => boolean,
  onStatus: (s: SaveStatus) => void,
  /** The open session, read when the version is saved. Null leaves the choice to the server. */
  getSessionId: () => string | null = () => null,
  onSaved?: () => void,
  /** The session was deleted elsewhere. Resolves when the code has a new session; the version is then saved there. */
  onSessionGone?: () => Promise<void>,
) {
  const seq = useRef(0);

  return useCallback(
    async (code: string) => {
      if (!api) return onStatus("signed-out");
      const mine = ++seq.current;
      const sessionId = getSessionId() ?? undefined;
      onStatus("saving");
      try {
        let version;
        try {
          version = await api.saveVersion(code, sessionId);
        } catch (err) {
          if (!sessionId || !onSessionGone || !(err instanceof ApiError && err.status === 404)) throw err;
          await onSessionGone();
          version = await api.saveVersion(code, getSessionId() ?? undefined);
        }
        onStatus("saved");
        if (!playStarted) {
          playStarted = true;
          track("play_started");
        }
        onSaved?.();
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        if (mine !== seq.current || !isPlaying()) return;
        const reading = await measure(WINDOW_MS);
        if (reading && mine === seq.current) {
          await api.saveAudio({ versionId: version.id, windowMs: WINDOW_MS, ...reading });
        }
      } catch (err) {
        console.error(err);
        if (mine === seq.current) onStatus("failed");
      }
    },
    [api, isPlaying, onStatus, getSessionId, onSaved, onSessionGone],
  );
}
