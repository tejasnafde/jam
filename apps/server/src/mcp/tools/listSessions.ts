import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult } from "../result.js";

export const registerListSessions: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description:
        "The user's sessions (named pieces), most recently edited first: name, how many versions, when it was last edited, and which one is open now.",
      annotations: READ_ONLY,
    },
    async () => {
      const current = await store.currentSession(uid);
      const sessions = await store.listSessions(uid);
      return jsonResult(
        sessions.map((s) => ({
          name: s.name,
          versionCount: s.versionCount,
          lastEdited: s.updatedAt,
          open: s.id === current.id,
        })),
      );
    },
  );
};
