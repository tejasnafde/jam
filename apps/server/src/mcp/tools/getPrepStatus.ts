import { SAMPLE_ID } from "@jam/shared";
import { z } from "zod";
import { withStaleness } from "../../store/prep.js";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult, textResult } from "../result.js";

export const registerGetPrepStatus: ToolRegistrar = (server, { uid, prep }) => {
  server.registerTool(
    "get_prep_status",
    {
      title: "Get prep status",
      description:
        "Status of the user's prep jobs (stem split, tempo match, key shift): queued, running, done or failed, the ops asked for and the ids of the samples made. Without job_id, the most recent jobs, newest first. Read only: the user starts prep jobs from the page.",
      inputSchema: {
        job_id: z.string().regex(SAMPLE_ID).optional().describe("One job. Leave out for the recent ones."),
        limit: z.number().int().min(1).max(20).default(5).describe("How many recent jobs, 1 to 20."),
      },
      annotations: READ_ONLY,
    },
    async ({ job_id, limit }) => {
      if (job_id) {
        const job = await prep.getJob(uid, job_id);
        return job ? jsonResult(withStaleness(job, Date.now())) : textResult(`No prep job ${job_id}.`);
      }
      // A dead worker shows as failed here too, without a write: this tool is read-only.
      const jobs = (await prep.listJobs(uid, limit)).map((j) => withStaleness(j, Date.now()));
      return jobs.length ? jsonResult(jobs) : textResult("No prep jobs yet.");
    },
  );
};
