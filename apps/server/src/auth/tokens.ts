import { createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "jam_";

/** A personal MCP token: the prefix plus 256 random bits. */
export function mintToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** Only this hash is stored. The token itself is shown to the user once. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
