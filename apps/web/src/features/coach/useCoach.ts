import { isListening, type CoachCadence, type CoachThread } from "@jam/shared";
import { useCallback, useRef, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import type { Api } from "@/lib/api";

/** How often the page checks the thread while a coach listens, and while none does. */
export const COACH_POLL_MS = 5000;
export const COACH_IDLE_POLL_MS = 20_000;

export interface CoachHandle {
  thread: CoachThread | null;
  /** Sends an ask. Empty text is "Check my music". */
  ask: (text: string) => Promise<void>;
  setCadence: (cadence: CoachCadence) => Promise<void>;
  /** Checks for a change now, for example after a run (which can add a check-in). */
  refresh: () => Promise<void>;
}

type Loaded = { api: Api; sessionId: string; thread: CoachThread };

/**
 * The coach thread of the open session. The coach answers through MCP, so the page polls. Each poll
 * reads only when the thread last changed, and reads the whole thread when that moves. It polls
 * faster while a coach listens, and loads again at once when another session opens.
 */
export function useCoach(api: Api | null, sessionId: string | null): CoachHandle {
  const [loaded, setLoadedState] = useState<Loaded | null>(null);
  const [fast, setFast] = useState(false);
  const latest = useRef<Loaded | null>(null);
  const setLoaded = useCallback((next: (prev: Loaded | null) => Loaded | null) => {
    setLoadedState((prev) => (latest.current = next(prev)));
  }, []);

  const load = useCallback(async () => {
    if (!api || !sessionId) return;
    const thread = await api.coachThread(sessionId);
    setLoaded(() => ({ api, sessionId, thread }));
    setFast(isListening(thread.listeningAt, Date.now()));
  }, [api, sessionId, setLoaded]);

  const check = useCallback(async () => {
    if (!api || !sessionId) return;
    const prev = latest.current;
    if (!prev || prev.api !== api || prev.sessionId !== sessionId) return load();
    const status = await api.coachStatus(sessionId);
    if (status.updatedAt !== prev.thread.updatedAt) return load();
    setFast(isListening(status.listeningAt, Date.now()));
    if (status.listeningAt !== prev.thread.listeningAt) {
      setLoaded((p) =>
        p && p.sessionId === sessionId ? { ...p, thread: { ...p.thread, listeningAt: status.listeningAt } } : p,
      );
    }
  }, [api, sessionId, load, setLoaded]);

  usePolling(api && sessionId ? check : null, fast ? COACH_POLL_MS : COACH_IDLE_POLL_MS, sessionId);
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
      // The server's copy, with its updatedAt, so the next poll does not read the thread again.
      await load().catch(console.error);
    },
    [api, sessionId, load, setLoaded],
  );

  const setCadence = useCallback(
    async (cadence: CoachCadence) => {
      if (!api || !sessionId) return;
      setLoaded((prev) =>
        prev && prev.sessionId === sessionId ? { ...prev, thread: { ...prev.thread, cadence } } : prev,
      );
      await api.setCoachCadence(sessionId, cadence);
    },
    [api, sessionId, setLoaded],
  );

  return { thread, ask, setCadence, refresh: check };
}
