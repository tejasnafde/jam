// The prep request the page sends. Extends PrepRequest in samples.ts (never edited) with
// sourceBpm: the source tempo the user confirmed, so a 60 BPM ballad that the detector
// reads as 120 is not stretched by half.
import { z } from "zod";
import { SampleId } from "./ids.js";
import { PrepRequest } from "./samples.js";

export const PrepOpsSchema = PrepRequest.shape.ops.extend({
  /** The source tempo for "tempo". Leave out to use the detected tempo. */
  sourceBpm: z.number().min(30).max(300).optional(),
});
export type PrepOps = z.infer<typeof PrepOpsSchema>;

export const prepRequestSchema = PrepRequest.extend({ sampleId: SampleId, ops: PrepOpsSchema })
  .refine(({ ops }) => ops.split === true || ops.tempo !== undefined || !!ops.semitones, {
    message: "Ask for at least one of split, tempo or a non-zero semitones.",
  })
  .refine(({ ops }) => ops.sourceBpm === undefined || ops.tempo !== undefined, {
    message: "sourceBpm needs a tempo.",
  });
export type PrepRequestBody = z.infer<typeof prepRequestSchema>;
