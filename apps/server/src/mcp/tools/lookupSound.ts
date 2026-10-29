import { z } from "zod";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { errorResult, jsonResult, textResult } from "../result.js";

export const registerLookupSound: ToolRegistrar = (server, { sounds }) => {
  server.registerTool(
    "lookup_sound",
    {
      title: "Look up a sound",
      description:
        "Search Strudel's default sound names: built-in synths, General MIDI soundfonts (gm_*), and the default sample banks and drum machines. Returns names and how to use them.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe("Part of a name, for example 'bd', '808', 'piano', 'gm_string'."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const found = await sounds.search(query, limit);
        return found.total === 0 ? textResult(`No default sound matches "${query}".`) : jsonResult(found);
      } catch (err) {
        return errorResult(`The sound index is unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
};
