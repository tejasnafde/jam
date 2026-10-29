import type { Sample } from "@jam/shared";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

/** What the coach sees of a sample: no storage path, no owner id. */
export const describeSample = ({ userId: _u, storagePath: _p, contentType: _c, ...rest }: Sample) => ({
  ...rest,
  usage: `s("${rest.name}")`,
});

export const registerListSamples: ToolRegistrar = (server, { uid, samples }) => {
  server.registerTool(
    "list_samples",
    {
      title: "List samples",
      description:
        'The user\'s own sample library, newest first: vocal takes, uploads, stems and prepared versions. Each has name, kind, durationSec, bpm and key when known, stats (rms and low/mid/high energy shares), parentId and stem for stems, and ops (effects or prep applied). Play one in Strudel with s("name").',
      annotations: READ_ONLY,
    },
    async () => {
      const list = await samples.list(uid);
      return list.length === 0
        ? textResult("The library is empty. The user can record a take or upload audio in the side panel.")
        : jsonResult(list.map(describeSample));
    },
  );
};
