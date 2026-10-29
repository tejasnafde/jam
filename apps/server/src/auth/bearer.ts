import type { Request } from "express";

/**
 * Reads a bearer token from the Authorization header only. A token in a query
 * string would be written to the Cloud Run request log, so it is never read.
 */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}
