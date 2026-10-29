// jam phase 3 shared contract. Copy this file VERBATIM to packages/shared/src/samples.ts
// and export it from packages/shared/src/index.ts. All three phase 3 branches use the
// identical file, so it merges without conflict. Do not edit it; extend in another file.
import { z } from "zod";

export const SAMPLE_BUCKET = "jam-samples-teejayproject";

/** Strudel-safe sample name: lowercase letters, digits, underscore. Unique per user. */
export const SampleName = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

export const SampleKind = z.enum(["take", "stem", "upload", "prepared"]);
export const StemPart = z.enum(["vocals", "drums", "bass", "other"]);

export const AudioStats = z.object({
  rms: z.number(),
  low: z.number(),
  mid: z.number(),
  high: z.number(),
});

export const Sample = z.object({
  id: z.string(),
  userId: z.string(),
  name: SampleName,
  kind: SampleKind,
  /** Object path in SAMPLE_BUCKET: users/{userId}/samples/{id}.{ext} */
  storagePath: z.string(),
  contentType: z.enum(["audio/wav", "audio/mpeg", "audio/webm", "audio/ogg"]),
  durationSec: z.number().nonnegative(),
  bpm: z.number().positive().optional(),
  key: z.string().optional(), // e.g. "F# minor"
  stats: AudioStats.optional(),
  parentId: z.string().optional(), // stem or prepared sample: the source sample
  stem: StemPart.optional(),
  /** Effects or prep ops applied, human readable, e.g. ["autotune:hard", "octave:-12"] */
  ops: z.array(z.string()).default([]),
  createdAt: z.string(), // ISO 8601
});
export type Sample = z.infer<typeof Sample>;

/** Firestore: database jam-db, collection users/{userId}/samples, doc id = Sample.id */
export const SAMPLES_COLLECTION = (userId: string) => `users/${userId}/samples`;

// REST API (owned by branch phase-3-library):
// POST   /api/samples/upload-url  body {name, contentType}       -> {id, uploadUrl, storagePath}
// POST   /api/samples             body Omit<Sample,"userId"|"createdAt">  -> Sample
// GET    /api/samples                                              -> {samples: (Sample & {url: string})[]}  (url = signed read URL, 1 h)
// DELETE /api/samples/:id                                          -> 204
// Prep API (owned by branch phase-3-prep):
// POST   /api/prep  body {sampleId, ops: {split?: boolean, tempo?: number, semitones?: number}} -> {jobId}
// GET    /api/prep/:jobId                                          -> {status: "queued"|"running"|"done"|"failed", sampleIds?: string[], error?: string}
export const CreateUploadUrl = z.object({ name: SampleName, contentType: Sample.shape.contentType });
export const PrepRequest = z.object({
  sampleId: z.string(),
  ops: z.object({
    split: z.boolean().optional(),
    tempo: z.number().min(40).max(220).optional(),
    semitones: z.number().int().min(-12).max(12).optional(),
  }),
});
export const PrepStatus = z.object({
  status: z.enum(["queued", "running", "done", "failed"]),
  sampleIds: z.array(z.string()).optional(),
  error: z.string().optional(),
});
