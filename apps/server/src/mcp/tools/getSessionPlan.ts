import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

export const registerGetSessionPlan: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "get_session_plan",
    {
      title: "Get session plan",
      description:
        "The plan of the session the user has open: destination, stages and the current stage index (0-based).",
      annotations: READ_ONLY,
    },
    async () => {
      const plan = await store.currentPlan(uid);
      return plan ? jsonResult(plan) : textResult("No session plan yet. Start one with set_session_plan.");
    },
  );
};
