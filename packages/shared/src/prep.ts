// Prep jobs (stem split, tempo match, key shift). Extends the phase 3 contract in samples.ts.
import { z } from "zod";
import { PrepOpsSchema } from "./prepRequest.js";
import { PrepStatus } from "./samples.js";

export type PrepStatusResponse = z.infer<typeof PrepStatus>;

/** Firestore: users/{uid}/prep_jobs/{id}. The Cloud Run job writes status, sampleIds and error. */
export const prepJobSchema = PrepStatus.extend({
  id: z.string(),
  sampleId: z.string(),
  ops: PrepOpsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrepJob = z.infer<typeof prepJobSchema>;

export const PREP_JOBS_COLLECTION = (userId: string) => `users/${userId}/prep_jobs`;

/** A queued or running job with no update for this long has died (the task timeout is 30 min). */
export const PREP_STALE_MS = 35 * 60_000;
export const PREP_WORKER_STOPPED = "The prep worker stopped.";

export const isPrepJobActive = (job: Pick<PrepJob, "status">) => job.status === "queued" || job.status === "running";

/** True for an active job whose worker must have died: the doc has no update for PREP_STALE_MS. */
export const isPrepJobStale = (job: Pick<PrepJob, "status" | "updatedAt">, nowMs: number) =>
  isPrepJobActive(job) && nowMs - Date.parse(job.updatedAt) >= PREP_STALE_MS;
