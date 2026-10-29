import { z } from "zod";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

export const registerGetAudioSnapshot: ToolRegistrar = (server, { uid, store }) => {
  server.registerTool(
    "get_audio_snapshot",
    {
      title: "Get audio snapshot",
      description:
        "Loudness and spectrum of what the user hears, measured in the browser a few seconds after each evaluation. rms is 0 to 1 (0.1 is moderate). low (<250 Hz), mid (250 Hz to 4 kHz) and high (>4 kHz) are shares of spectral energy that add up to 1.",
      inputSchema: {
        limit: z.number().int().min(1).max(20).default(1).describe("How many snapshots, newest first."),
      },
      annotations: READ_ONLY,
    },
    async ({ limit }) => {
      const snapshots = await store.listAudio(uid, limit);
      if (snapshots.length === 0) {
        return textResult(
          "No audio snapshots yet. The page records one a few seconds after each evaluation while sound plays.",
        );
      }
      return jsonResult(snapshots);
    },
  );
};
