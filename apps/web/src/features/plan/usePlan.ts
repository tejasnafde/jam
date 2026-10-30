import type { SessionPlan } from "@jam/shared";
import { useCallback, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import type { Api } from "@/lib/api";

const POLL_MS = 8000;

/**
 * The plan of the open session. The coach writes it through MCP, so the page polls for it,
 * and loads it again at once when another session opens.
 */
export function usePlan(api: Api | null, sessionId: string | null = null): SessionPlan | null {
  // Tagged with the account and session it was loaded for, so a switch never shows a stale plan.
  const [loaded, setLoaded] = useState<{ api: Api; sessionId: string | null; plan: SessionPlan | null } | null>(null);
  const load = useCallback(async () => {
    if (api) setLoaded({ api, sessionId, plan: await api.currentPlan() });
  }, [api, sessionId]);
  usePolling(api ? load : null, POLL_MS, sessionId);
  return loaded && loaded.api === api && loaded.sessionId === sessionId ? loaded.plan : null;
}
