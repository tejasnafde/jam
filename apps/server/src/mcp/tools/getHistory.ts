import { LIMITS, type CodeVersion } from "@jam/shared";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

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
        "Recent evaluated versions, newest first. With include_diffs, each version shows a unified diff from the one before it instead of the full code.",
      inputSchema: {
        limit: z.number().int().min(1).max(LIMITS.historyMax).default(10).describe("How many versions, 1 to 50."),
        include_diffs: z
          .boolean()
          .default(true)
          .describe("Show diffs instead of full code. The very first version always has full code."),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, include_diffs }) => {
      // One extra, so the oldest returned version can also be diffed.
      const versions = await store.listVersions(uid, limit + 1);
      if (versions.length === 0) return textResult("No history yet.");
      return jsonResult(describeHistory(versions, limit, include_diffs));
    },
  );
};
