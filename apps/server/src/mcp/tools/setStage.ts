import { z } from "zod";
import { PLAN_WRITE, type ToolRegistrar } from "../context.js";
import { errorResult, jsonResult } from "../result.js";

export const registerSetStage: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "set_stage",
    {
      title: "Set current stage",
      description: "Move the current plan to another stage (0-based), with an optional short note shown on the page.",
      inputSchema: {
        stage: z.number().int().min(0).describe("0-based stage index."),
        note: z.string().trim().max(240).optional().describe("A short encouraging note, not code."),
      },
      annotations: PLAN_WRITE,
    },
    async ({ stage, note }) => {
      const plan = await store.currentPlan(uid);
      if (!plan) return errorResult("No session plan yet. Create one with set_session_plan first.");
      const last = plan.stages.length - 1;
      if (stage > last) return errorResult(`Stage ${stage} does not exist. The plan has stages 0 to ${last}.`);
      return jsonResult(await store.updatePlan(uid, plan.id, { currentStage: stage, note: note ?? "" }));
    },
  );
};
