import type { SessionPlan } from "@jam/shared";
import { useCallback, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import type { Api } from "@/lib/api";

const POLL_MS = 8000;

/** The coach writes the plan through MCP, so the page polls for it. */
export function usePlan(api: Api | null): SessionPlan | null {
  // Tagged with the account it was loaded for, so a sign-out never shows a stale plan.
  const [loaded, setLoaded] = useState<{ api: Api; plan: SessionPlan | null } | null>(null);
  const load = useCallback(async () => {
    if (api) setLoaded({ api, plan: await api.currentPlan() });
  }, [api]);
  usePolling(api ? load : null, POLL_MS);
  return loaded && loaded.api === api ? loaded.plan : null;
}
