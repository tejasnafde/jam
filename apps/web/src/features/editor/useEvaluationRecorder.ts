import { useCallback, useRef } from "react";
import type { Api } from "@/lib/api";
import { measure } from "@/lib/audio";

const SETTLE_MS = 1000;
const WINDOW_MS = 3000;

export type SaveStatus = "idle" | "saving" | "saved" | "failed" | "signed-out";

/**
 * Saves each successful evaluation, then measures a few seconds of sound and
 * stores that as the version's audio snapshot. A newer evaluation cancels the
 * pending measurement of an older one.
 */
export function useEvaluationRecorder(api: Api | null, isPlaying: () => boolean, onStatus: (s: SaveStatus) => void) {
  const seq = useRef(0);

  return useCallback(
    async (code: string) => {
      if (!api) return onStatus("signed-out");
      const mine = ++seq.current;
      onStatus("saving");
      try {
        const version = await api.saveVersion(code);
        onStatus("saved");
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
    [api, isPlaying, onStatus],
  );
}
