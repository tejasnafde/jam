// Library API types on top of the shared samples contract (samples.ts, never edited).
import { z } from "zod";
import { Sample } from "./samples.js";

export const SAMPLE_MAX_BYTES = 50 * 1024 * 1024;

export const SAMPLE_EXT = {
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
} as const satisfies Record<Sample["contentType"], string>;

/** Object path in SAMPLE_BUCKET for a sample. */
export const samplePath = (userId: string, id: string, contentType: Sample["contentType"]) =>
  `users/${userId}/samples/${id}.${SAMPLE_EXT[contentType]}`;

export const RegisterSample = Sample.omit({ userId: true, createdAt: true });
export type RegisterSample = z.input<typeof RegisterSample>;

export interface UploadUrlResponse {
  id: string;
  uploadUrl: string;
  storagePath: string;
}

export type SampleWithUrl = Sample & { url: string };
