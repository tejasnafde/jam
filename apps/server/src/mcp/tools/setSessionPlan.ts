import { planInputSchema } from "@jam/shared";
import { PLAN_WRITE, type ToolRegistrar } from "../context.js";
import { jsonResult } from "../result.js";

export const registerSetSessionPlan: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "set_session_plan",
    {
      title: "Set session plan",
      description:
        "Start a new plan for the session the user has open: what we are about to paint today. Replaces that session's plan (old plans are kept). Each session keeps its own plan. 4 to 6 stages, each a goal and at most one hint, never exact code. This writes the plan only, never the user's music.",
      inputSchema: planInputSchema.shape,
      annotations: PLAN_WRITE,
    },
    async (input) => {
      const session = await store.currentSession(uid);
      const plan = await store.savePlan(uid, input, session.id);
      return jsonResult({ session: session.name, ...plan });
    },
  );
};
