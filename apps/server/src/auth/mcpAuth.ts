// MCP auth is a list of authenticators tried in order: the personal key
// minted on the page (`jam_...`), then an OAuth 2.1 access token
// (`jama_...`, see src/oauth). The MCP route does not know which one ran.

import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../logger.js";
import type { Store } from "../store/types.js";
import { bearerFrom } from "./bearer.js";
import { hashToken, TOKEN_PREFIX } from "./tokens.js";

export interface Principal {
  uid: string;
  via: "personal-token" | "oauth";
  /** The OAuth client, when via is "oauth". */
  clientId?: string;
}

export interface McpAuthChallenge {
  /** RFC 9728 metadata URL, sent in WWW-Authenticate so a client can discover OAuth. */
  resourceMetadataUrl: string;
  scope: string;
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

export function requireMcpAuth(authenticators: McpAuthenticator[], challenge: McpAuthChallenge) {
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
    const params = [
      'realm="jam"',
      ...(bearer ? ['error="invalid_token"'] : []),
      `resource_metadata="${challenge.resourceMetadataUrl}"`,
      `scope="${challenge.scope}"`,
    ];
    res
      .status(401)
      .set("WWW-Authenticate", `Bearer ${params.join(", ")}`)
      .json({
        error: bearer ? "invalid_token" : "unauthorized",
        message: "Sign in through OAuth, or send Authorization: Bearer <key> with a key from the jam page.",
      });
  };
}
