import { COACH_NOTE_MAX } from "@jam/shared";
import { z } from "zod";
import { COACH_WRITE, type ToolRegistrar } from "../context.js";
import { errorResult, jsonResult } from "../result.js";

export const registerSay: ToolRegistrar = (server, { uid, store, coach }) => {
  server.registerTool(
    "say",
    {
      title: "Say to the user",
      description: `Posts a short coach note in the Coach thread on the page, in the session the user has open (or the one named). At most ${COACH_NOTE_MAX} characters: one hint at most, and a question. Inline code for a function name is fine; never a finished pattern. It writes only coach text, never the user's music.`,
      inputSchema: {
        text: z.string().trim().min(1).describe(`The note, at most ${COACH_NOTE_MAX} characters.`),
        session: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe(
            "The session the event came from, when wait_for_change says it is not the open one. Leave out for the open session.",
          ),
      },
      annotations: COACH_WRITE,
    },
    async ({ text, session: name }) => {
      if (text.length > COACH_NOTE_MAX) {
        return errorResult(
          `That note is ${text.length} characters. Keep it under ${COACH_NOTE_MAX}: one hint and a question.`,
        );
      }
      let session: { id: string; name: string } = await store.currentSession(uid);
      if (name !== undefined && name !== session.name) {
        // Newest edit first, so a name used twice finds the one touched last.
        const all = await store.listSessions(uid);
        const found = all.find((s) => s.name === name) ?? all.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!found) {
          return errorResult(`No session is named "${name}". Sessions: ${all.map((s) => `"${s.name}"`).join(", ")}.`);
        }
        session = found;
      }
      const note = await store.addCoachEvent(uid, session.id, { kind: "note", text }, coach.now());
      if (!note) return errorResult("The user's session is gone. Call wait_for_change again.");
      return jsonResult({ posted: true, session: session.name, id: note.id });
    },
  );
};
