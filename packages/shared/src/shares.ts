// Shares: a read-only link to one rendered pass of a piece, as it was at one version.
// Firestore: top-level shares/{shareId}. Audio: SAMPLE_BUCKET at shares/{shareId}.wav.
import { z } from "zod";
import { SessionId } from "./sessions.js";

/** 10 url-safe characters (60 random bits). */
export const SHARE_ID = /^[A-Za-z0-9_-]{10}$/;
export const ShareId = z.string().regex(SHARE_ID);

export const SHARE_LIMITS = {
  /** Enabled shares per user. Turned-off shares do not count. */
  activePerUser: 50,
  barsMin: 1,
  barsMax: 256,
  /** The longest piece a share plays, without the tail. */
  maxSeconds: 240,
  /** The reverb tail recorded after the last bar. */
  tailSeconds: 2,
  /** The page aims below this and drops to mono (then a lower rate) to stay under it. */
  targetBytes: 25 * 1024 * 1024,
  /** What GCS accepts for one upload. */
  maxBytes: 26 * 1024 * 1024,
  titleMax: 80,
  ownerNameMax: 40,
} as const;

/** Signed into every share upload URL and sent with the PUT, so GCS rejects a larger body. */
export const SHARE_UPLOAD_HEADERS = {
  "x-goog-content-length-range": `0,${SHARE_LIMITS.maxBytes}`,
} as const;

/** Object path in SAMPLE_BUCKET. It holds no user id, so a signed URL tells nothing about the owner. */
export const sharePath = (id: string) => `shares/${id}.wav`;

export const createShareRequestSchema = z.object({
  sessionId: SessionId,
  /** The version the dialog showed. The server refuses when the session has a newer one. */
  versionId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(SHARE_LIMITS.titleMax),
  ownerName: z.string().trim().min(1).max(SHARE_LIMITS.ownerNameMax),
  bars: z.number().int().min(SHARE_LIMITS.barsMin).max(SHARE_LIMITS.barsMax),
  seconds: z.number().positive().max(SHARE_LIMITS.maxSeconds),
  showCode: z.boolean().default(false),
});
export type CreateShareRequest = z.input<typeof createShareRequestSchema>;

export interface CreateShareResponse {
  id: string;
  uploadUrl: string;
  /** The public page, e.g. https://jam.tn07.dev/s/abc123DEF_ */
  url: string;
}

export const updateShareRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().trim().min(1).max(SHARE_LIMITS.titleMax).optional(),
  })
  .refine((b) => b.enabled !== undefined || b.title !== undefined, "Send enabled or title.");
export type UpdateShareRequest = z.infer<typeof updateShareRequestSchema>;

/** A share as its owner sees it. No uid and no storage path. */
export const shareSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  versionId: z.string(),
  title: z.string(),
  ownerName: z.string(),
  /** When the shared version was evaluated. */
  asOf: z.string(),
  bars: z.number().int(),
  seconds: z.number(),
  showCode: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string(),
  plays: z.number().int().min(0),
});
export type Share = z.infer<typeof shareSchema>;

export interface ShareListResponse {
  shares: Share[];
}

/** What anyone with the link gets. Never the uid, the session, or the storage path. */
export const publicShareSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerName: z.string(),
  asOf: z.string(),
  bars: z.number().int(),
  seconds: z.number(),
  /** Only when the owner chose "Show the code". */
  code: z.string().nullable(),
  /** A short-lived signed read URL of the WAV. */
  audioUrl: z.string(),
  /** Same file, sent as an attachment. */
  downloadUrl: z.string(),
  createdAt: z.string(),
});
export type PublicShare = z.infer<typeof publicShareSchema>;

/** m:ss, for lengths under an hour. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The first name of a display name, for "by Tejas". */
export function firstName(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, SHARE_LIMITS.ownerNameMax);
}

/** The text a link preview shows, e.g. "A 0:38 jam by Tejas". */
export const shareDescription = (seconds: number, ownerName: string) =>
  `A ${formatDuration(seconds)} jam by ${ownerName}`;
