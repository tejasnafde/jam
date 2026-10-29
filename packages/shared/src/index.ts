// Schemas and types shared by the web app and the server.
// The server validates every request body with these; the web app uses the
// inferred types so both sides agree on the wire format.

import { z } from "zod";

export const LIMITS = {
  codeMaxChars: 100_000,
  stagesMin: 4,
  stagesMax: 6,
  tokensPerUser: 10,
  historyMax: 50,
  audioWindowMaxMs: 60_000,
} as const;

// ---------- Domain ----------

export const codeVersionSchema = z.object({
  id: z.string(),
  code: z.string(),
  createdAt: z.string(),
  evaluatedAt: z.string(),
  evalCount: z.number().int(),
});
export type CodeVersion = z.infer<typeof codeVersionSchema>;

const unitInterval = z.number().finite().min(0).max(1);

export const audioReadingSchema = z.object({
  rms: unitInterval,
  low: unitInterval,
  mid: unitInterval,
  high: unitInterval,
});
export type AudioReading = z.infer<typeof audioReadingSchema>;

export const audioSnapshotSchema = audioReadingSchema.extend({
  id: z.string(),
  versionId: z.string().nullable(),
  windowMs: z.number().int(),
  createdAt: z.string(),
});
export type AudioSnapshot = z.infer<typeof audioSnapshotSchema>;

export const stageSchema = z.object({
  title: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(400).describe("What the user is aiming for, in words. Not code."),
  hint: z
    .string()
    .trim()
    .max(240)
    .optional()
    .describe("At most one hint. An idea or a function name, never a finished line."),
});
export type Stage = z.infer<typeof stageSchema>;

export const planInputSchema = z.object({
  destination: z.string().trim().min(1).max(600).describe("The piece the user is heading for, in a sentence or two."),
  stages: z.array(stageSchema).min(LIMITS.stagesMin).max(LIMITS.stagesMax),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export const sessionPlanSchema = planInputSchema.extend({
  id: z.string(),
  currentStage: z.number().int().min(0),
  note: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionPlan = z.infer<typeof sessionPlanSchema>;

export const tokenInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type TokenInfo = z.infer<typeof tokenInfoSchema>;

// ---------- REST API ----------

export const saveVersionRequestSchema = z.object({
  code: z.string().max(LIMITS.codeMaxChars),
});
export type SaveVersionRequest = z.infer<typeof saveVersionRequestSchema>;

export const saveVersionResponseSchema = z.object({ id: z.string(), evalCount: z.number().int() });
export type SaveVersionResponse = z.infer<typeof saveVersionResponseSchema>;

export const saveAudioRequestSchema = audioReadingSchema.extend({
  versionId: z.string().max(64).nullable().optional(),
  windowMs: z.number().int().min(0).max(LIMITS.audioWindowMaxMs),
});
export type SaveAudioRequest = z.infer<typeof saveAudioRequestSchema>;

export const createTokenRequestSchema = z.object({
  label: z.string().trim().min(1).max(60).default("assistant"),
});
export type CreateTokenRequest = z.input<typeof createTokenRequestSchema>;

export const createTokenResponseSchema = tokenInfoSchema.extend({ token: z.string() });
export type CreateTokenResponse = z.infer<typeof createTokenResponseSchema>;

export interface ApiError {
  error: string;
  message?: string;
}
export * from "./samples.js";
export * from "./sampleApi.js";
