import type { CoachCadence, CoachThread } from "@jam/shared";
import { useCallback, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import type { Api } from "@/lib/api";

const POLL_MS = 5000;

export interface CoachHandle {
  thread: CoachThread | null;
  /** Sends an ask. Empty text is "Check my music". */
  ask: (text: string) => Promise<void>;
  setCadence: (cadence: CoachCadence) => Promise<void>;
}

/**
 * The coach thread of the open session. The coach answers through MCP, so the page polls,
 * and loads again at once when another session opens.
 */
export function useCoach(api: Api | null, sessionId: string | null): CoachHandle {
  const [loaded, setLoaded] = useState<{ api: Api; sessionId: string; thread: CoachThread } | null>(null);
  const load = useCallback(async () => {
    if (api && sessionId) setLoaded({ api, sessionId, thread: await api.coachThread(sessionId) });
  }, [api, sessionId]);
  usePolling(api && sessionId ? load : null, POLL_MS, sessionId);
  const thread = loaded && loaded.api === api && loaded.sessionId === sessionId ? loaded.thread : null;

  const ask = useCallback(
    async (text: string) => {
      if (!api || !sessionId) return;
      const event = await api.askCoach(sessionId, text);
      setLoaded((prev) =>
        prev && prev.sessionId === sessionId
          ? { ...prev, thread: { ...prev.thread, events: [...prev.thread.events, event] } }
          : prev,
      );
    },
    [api, sessionId],
  );

  const setCadence = useCallback(
    async (cadence: CoachCadence) => {
      if (!api || !sessionId) return;
      setLoaded((prev) =>
        prev && prev.sessionId === sessionId ? { ...prev, thread: { ...prev.thread, cadence } } : prev,
      );
      await api.setCoachCadence(sessionId, cadence);
    },
    [api, sessionId],
  );

  return { thread, ask, setCadence };
}
