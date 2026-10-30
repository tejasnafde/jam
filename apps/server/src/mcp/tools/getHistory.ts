import { LIMITS, type CodeVersion } from "@jam/shared";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { errorResult, jsonResult, textResult } from "../result.js";

/** Each version shows a diff from the one before it, when that one is known. */
export function describeHistory(newestFirst: CodeVersion[], limit: number, includeDiffs: boolean) {
  return newestFirst.slice(0, limit).map((version, i) => {
    const previous = newestFirst[i + 1];
    const meta = {
      id: version.id,
      createdAt: version.createdAt,
      evaluatedAt: version.evaluatedAt,
      evalCount: version.evalCount,
    };
    if (includeDiffs && previous) {
      const diff = createTwoFilesPatch(
        previous.id,
        version.id,
        previous.code,
        version.code,
        previous.createdAt,
        version.createdAt,
      );
      return { ...meta, diff };
    }
    return { ...meta, code: version.code };
  });
}

export const registerGetHistory: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "get_history",
    {
      title: "Get code history",
      description:
        "Recent evaluated versions of one session (the open one, or the one named), newest first. With include_diffs, each version shows a unified diff from the one before it instead of the full code.",
      inputSchema: {
        limit: z.number().int().min(1).max(LIMITS.historyMax).default(10).describe("How many versions, 1 to 50."),
        include_diffs: z
          .boolean()
          .default(true)
          .describe("Show diffs instead of full code. The very first version always has full code."),
        session: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe("A session name from list_sessions. Leave out for the session the user has open."),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, include_diffs, session: name }) => {
      let session = await store.currentSession(uid);
      if (name !== undefined) {
        // Newest edit first, so a name used twice finds the one touched last.
        const all = await store.listSessions(uid);
        const found = all.find((s) => s.name === name) ?? all.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!found) {
          return errorResult(`No session is named "${name}". Sessions: ${all.map((s) => `"${s.name}"`).join(", ")}.`);
        }
        session = found;
      }
      // One extra, so the oldest returned version can also be diffed.
      const versions = await store.listVersions(uid, limit + 1, { sessionId: session.id });
      if (versions.length === 0) return textResult(`No history yet in the session "${session.name}".`);
      return jsonResult({ session: session.name, versions: describeHistory(versions, limit, include_diffs) });
    },
  );
};
