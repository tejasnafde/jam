import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

export const registerGetCurrentCode: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "get_current_code",
    {
      title: "Get current code",
      description:
        "The Strudel code the user last evaluated (Ctrl+Enter, or Option+Enter on a Mac) in the session they have open, with the session name, when it ran and how often.",
      annotations: READ_ONLY,
    },
    async () => {
      const session = await store.currentSession(uid);
      const version = await store.latestVersion(uid, session.id);
      if (!version) return textResult(`The user has not evaluated any code yet in the session "${session.name}".`);
      const { id, code, createdAt, evaluatedAt, evalCount } = version;
      return jsonResult({ session: session.name, id, code, createdAt, evaluatedAt, evalCount });
    },
  );
};
