import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken } from "../auth/tokens.js";

// OAuth credentials are opaque random strings. Only their SHA-256 is stored.
// The prefixes keep them apart from personal keys (`jam_`) and from each other.
export const ACCESS_PREFIX = "jama_";
export const REFRESH_PREFIX = "jamr_";
export const CODE_PREFIX = "jamc_";

export const mintSecret = (prefix = "") => prefix + randomBytes(32).toString("base64url");

/** A random id that is not a credential (a pending request, a grant). */
export const mintId = () => randomBytes(16).toString("base64url");

export const hashSecret = hashToken;

/** Compares a presented secret with a stored hash in constant time. */
export function secretMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
