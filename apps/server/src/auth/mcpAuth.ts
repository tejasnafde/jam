// MCP auth is a list of authenticators tried in order. Phase 1 has one: the
// personal token minted on the page. Phase 2 adds an OAuth 2.1 access-token
// authenticator to the same list, so the MCP route does not change.

import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../logger.js";
import type { Store } from "../store/types.js";
import { bearerFrom } from "./bearer.js";
import { hashToken, TOKEN_PREFIX } from "./tokens.js";

export interface Principal {
  uid: string;
  via: "personal-token" | "oauth";
}

export type McpAuthenticator = (bearer: string) => Promise<Principal | null>;

export function personalTokenAuthenticator(store: Store, log: Logger): McpAuthenticator {
  return async (bearer) => {
    if (!bearer.startsWith(TOKEN_PREFIX)) return null;
    const hash = hashToken(bearer);
    const record = await store.findToken(hash);
    if (!record) return null;
    // A failed timestamp write must not fail the request.
    store
      .touchToken(hash)
      .catch((err: unknown) => log.warn("token touch failed", { uid: record.uid, err: String(err) }));
    return { uid: record.uid, via: "personal-token" };
  };
}

export function requireMcpAuth(authenticators: McpAuthenticator[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bearer = bearerFrom(req);
    if (bearer) {
      try {
        for (const authenticate of authenticators) {
          const principal = await authenticate(bearer);
          if (principal) {
            req.principal = principal;
            return next();
          }
        }
      } catch (err) {
        return next(err);
      }
    }
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="jam"')
      .json({ error: "unauthorized", message: "Send Authorization: Bearer <token>. Create a token on the jam page." });
  };
}
