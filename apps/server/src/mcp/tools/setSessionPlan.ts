import { planInputSchema } from "@jam/shared";
import { PLAN_WRITE, type ToolRegistrar } from "../context.js";
import { jsonResult } from "../result.js";

export const registerSetSessionPlan: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "set_session_plan",
    {
      title: "Set session plan",
      description:
        "Start a new session plan: what we are about to paint today. Replaces the current plan (old plans are kept). 4 to 6 stages, each a goal and at most one hint, never exact code. This writes the plan only, never the user's music.",
      inputSchema: planInputSchema.shape,
      annotations: PLAN_WRITE,
    },
    async (input) => jsonResult(await store.savePlan(uid, input)),
  );
};
