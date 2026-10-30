// Sessions: named pieces a user comes back to. Each version and each plan belongs to one.
import { z } from "zod";
import { LIMITS } from "./limits.js";

/** A session id from a client: a Firestore doc id, no "/", never empty. */
export const SessionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const sessionNameSchema = z.string().trim().min(1).max(60);

/** The session that collects versions made before sessions existed. Created on first load. */
export const UNTITLED_SESSION_ID = "untitled";
export const UNTITLED_SESSION_NAME = "Untitled";

export const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  /** The last edit: a version, a saved draft, a rename. */
  updatedAt: z.string(),
  /** The editor text when the session was last left or saved. It may not have been evaluated. */
  lastCode: z.string(),
  versionCount: z.number().int().min(0),
  /** The session's plan ("Today we paint"). */
  planId: z.string().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionSchema),
  currentId: z.string(),
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const createSessionRequestSchema = z.object({
  name: sessionNameSchema.default(UNTITLED_SESSION_NAME),
  lastCode: z.string().max(LIMITS.codeMaxChars).default(""),
});
export type CreateSessionRequest = z.input<typeof createSessionRequestSchema>;

export const updateSessionRequestSchema = z
  .object({
    name: sessionNameSchema.optional(),
    lastCode: z.string().max(LIMITS.codeMaxChars).optional(),
  })
  .refine((b) => b.name !== undefined || b.lastCode !== undefined, "Send a name or lastCode.");
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

export const duplicateSessionRequestSchema = z.object({ name: sessionNameSchema.optional() });
export type DuplicateSessionRequest = z.infer<typeof duplicateSessionRequestSchema>;

/** Opening a session saves the editor text of the one the user leaves, so nothing is lost. */
export const openSessionRequestSchema = z.object({
  previous: z
    .object({
      id: SessionId,
      lastCode: z.string().max(LIMITS.codeMaxChars),
    })
    .optional(),
});
export type OpenSessionRequest = z.infer<typeof openSessionRequestSchema>;

export const VERSION_PAGE_MAX = 50;

export const versionPageQuerySchema = z.object({
  /** createdAt of the oldest version already shown. */
  before: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(VERSION_PAGE_MAX).default(10),
});

export const versionEntrySchema = z.object({
  id: z.string(),
  code: z.string(),
  createdAt: z.string(),
  evaluatedAt: z.string(),
  evalCount: z.number().int(),
  /** One line: the first line that changed from the version before it. */
  summary: z.string(),
});
export type VersionEntry = z.infer<typeof versionEntrySchema>;

export const versionPageSchema = z.object({
  versions: z.array(versionEntrySchema),
  /** Pass as `before` for the next page. Null on the last page. */
  nextBefore: z.string().nullable(),
});
export type VersionPage = z.infer<typeof versionPageSchema>;

/** Up to this many characters of a summary line. */
const SUMMARY_MAX = 120;

const clip = (line: string) => {
  const t = line.trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 3)}...` : t;
};

/**
 * A one-line summary of a version: the first line that differs from the version
 * before it. The first version shows its first line of code.
 */
export function summarizeChange(previous: string | null, code: string): string {
  const next = code.split("\n");
  if (previous === null) {
    const first = next.find((l) => l.trim() && !l.trim().startsWith("//")) ?? next.find((l) => l.trim());
    return first ? clip(first) : "(empty)";
  }
  const prev = previous.split("\n");
  // Lines kept at the start and the end; what is between them changed.
  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head]) head++;
  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }
  const added = next.slice(head, next.length - tail).find((l) => l.trim());
  if (added !== undefined) return clip(added);
  const removed = prev.slice(head, prev.length - tail).find((l) => l.trim());
  if (removed !== undefined) return `removed: ${clip(removed)}`;
  if (prev.length !== next.length || head < next.length) return "(blank lines)";
  return "(no change)";
}
