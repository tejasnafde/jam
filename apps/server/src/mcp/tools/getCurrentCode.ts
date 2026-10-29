import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

export const registerGetCurrentCode: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "get_current_code",
    {
      title: "Get current code",
      description: "The Strudel code the user last evaluated (Ctrl+Enter), with when it ran and how often.",
      annotations: READ_ONLY,
    },
    async () => {
      const version = await store.latestVersion(uid);
      return version ? jsonResult(version) : textResult("The user has not evaluated any code yet.");
    },
  );
};
