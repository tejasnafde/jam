import { SampleName } from "@jam/shared";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";
import { describeSample } from "./listSamples.js";

export const registerGetSample: ToolRegistrar = (server, { uid, samples }) => {
  server.registerTool(
    "get_sample",
    {
      title: "Get a sample",
      description: "One sample from the user's library by its Strudel name, with its stems and prepared versions.",
      inputSchema: { name: SampleName.describe('The sample name, as used in s("name").') },
      annotations: READ_ONLY,
    },
    async ({ name }) => {
      const sample = await samples.findByName(uid, name);
      if (!sample) return textResult(`No sample named "${name}". Use list_samples to see the library.`);
      const children = (await samples.list(uid)).filter((s) => s.parentId === sample.id).map((s) => s.name);
      return jsonResult({ ...describeSample(sample), children });
    },
  );
};
