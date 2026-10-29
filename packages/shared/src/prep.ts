// Prep jobs (stem split, tempo match, key shift). Extends the phase 3 contract in samples.ts.
import { z } from "zod";
import { PrepRequest, PrepStatus } from "./samples.js";

export type PrepOps = z.infer<typeof PrepRequest>["ops"];
export type PrepStatusResponse = z.infer<typeof PrepStatus>;

/** At least one op must be asked for. */
export const prepRequestSchema = PrepRequest.refine(
  ({ ops }) => ops.split === true || ops.tempo !== undefined || !!ops.semitones,
  { message: "Ask for at least one of split, tempo or a non-zero semitones." },
);
export type PrepRequestBody = z.infer<typeof prepRequestSchema>;

/** Firestore: users/{uid}/prep_jobs/{id}. The Cloud Run job writes status, sampleIds and error. */
export const prepJobSchema = PrepStatus.extend({
  id: z.string(),
  sampleId: z.string(),
  ops: PrepRequest.shape.ops,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrepJob = z.infer<typeof prepJobSchema>;

export const PREP_JOBS_COLLECTION = (userId: string) => `users/${userId}/prep_jobs`;
