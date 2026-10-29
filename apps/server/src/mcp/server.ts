// One MCP server is built per request (stateless Streamable HTTP), scoped to
// the authenticated user. No tool writes, edits or deletes code; the only
// writes are to the session plan.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { COACH_RULES } from "./coach.js";
import type { ToolContext, ToolRegistrar } from "./context.js";
import { registerStartSession } from "./prompts/startSession.js";
import { registerGetAudioSnapshot } from "./tools/getAudioSnapshot.js";
import { registerGetCurrentCode } from "./tools/getCurrentCode.js";
import { registerGetPrepStatus } from "./tools/getPrepStatus.js";
import { registerGetHistory } from "./tools/getHistory.js";
import { registerGetSample } from "./tools/getSample.js";
import { registerGetSessionPlan } from "./tools/getSessionPlan.js";
import { registerListSamples } from "./tools/listSamples.js";
import { registerLookupSound } from "./tools/lookupSound.js";
import { registerSetSessionPlan } from "./tools/setSessionPlan.js";
import { registerSetStage } from "./tools/setStage.js";

const TOOLS: Record<string, ToolRegistrar> = {
  get_current_code: registerGetCurrentCode,
  get_history: registerGetHistory,
  get_audio_snapshot: registerGetAudioSnapshot,
  lookup_sound: registerLookupSound,
  get_session_plan: registerGetSessionPlan,
  list_samples: registerListSamples,
  get_sample: registerGetSample,
  set_session_plan: registerSetSessionPlan,
  set_stage: registerSetStage,
  get_prep_status: registerGetPrepStatus,
};

export const TOOL_NAMES = Object.keys(TOOLS);

export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "jam", version: "0.1.0" }, { instructions: COACH_RULES });
  for (const register of Object.values(TOOLS)) register(server, ctx);
  registerStartSession(server);
  return server;
}
