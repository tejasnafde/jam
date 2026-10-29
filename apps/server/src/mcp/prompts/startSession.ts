import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { startSessionPrompt } from "../coach.js";

export function registerStartSession(server: McpServer) {
  server.registerPrompt(
    "start_session",
    {
      title: "Start a jam session",
      description:
        "Begin a coaching session: describe what we are about to paint today, save a plan, start on stage 1.",
      argsSchema: {
        mood: z.string().max(200).optional().describe("What the user feels like playing, for example 'dark techno'."),
        minutes: z.string().max(20).optional().describe("Roughly how long the session should be."),
      },
    },
    ({ mood, minutes }) => ({
      messages: [{ role: "user", content: { type: "text", text: startSessionPrompt(mood, minutes) } }],
    }),
  );
}
