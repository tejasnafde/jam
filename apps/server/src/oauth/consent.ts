// The REST side of the consent page, under /api/oauth. Reading a pending
// request needs only the browser-binding cookie, so the page can name the app
// before sign-in. Deciding needs the cookie and a Firebase ID token, so the
// decision is bound to both the browser and the signed-in user. The ID token
// travels in a header, never a cookie, so a cross-site form cannot decide.

import {
  consentDecisionRequestSchema,
  type ConsentDecisionResponse,
  type ConsentRequestInfo,
  type GrantInfo,
} from "@jam/shared";
import express, { Router, type Request, type Response } from "express";
import { pageUser, requireUser, type IdTokenVerifier } from "../auth/userAuth.js";
import type { Logger } from "../logger.js";
import { asyncHandler, parseBody } from "../routes/validate.js";
import type { AuthRequestRecord, GrantRecord, OAuthStore } from "../store/types.js";
import { browserHashFrom } from "./browserBinding.js";
import { displayName, type JamClientsStore } from "./clients.js";
import type { JamOAuthProvider } from "./provider.js";
import type { OAuthSettings } from "./settings.js";

interface ConsentDeps {
  store: OAuthStore;
  clients: JamClientsStore;
  provider: JamOAuthProvider;
  settings: OAuthSettings;
  verifyIdToken: IdTokenVerifier;
  log: Logger;
}

const toGrantInfo = ({ id, clientName, createdAt, lastUsedAt }: GrantRecord): GrantInfo => ({
  id,
  clientName,
  createdAt,
  lastUsedAt,
});

export function consentRouter({ store, clients, provider, settings, verifyIdToken, log }: ConsentDeps) {
  const router = Router();
  router.use(express.json({ limit: "4kb" }));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const user = requireUser(verifyIdToken);

  /** Loads a pending request this browser may act on, or answers with an error and returns null. */
  async function pending(req: Request, res: Response): Promise<AuthRequestRecord | null> {
    const request = await store.getAuthRequest(String(req.params.id));
    if (!request || request.expiresAt <= settings.now()) {
      res.status(404).json({ error: "expired", message: "This request has expired or was already answered." });
      return null;
    }
    if (browserHashFrom(req, settings) !== request.browserHash) {
      res.status(403).json({ error: "wrong_browser", message: "This request was started in another browser." });
      return null;
    }
    return request;
  }

  router.get(
    "/requests/:id",
    asyncHandler(async (req, res) => {
      const request = await pending(req, res);
      if (!request) return;
      const client = await clients.getRecord(request.clientId);
      if (!client) {
        res.status(404).json({ error: "expired", message: "The app is no longer registered." });
        return;
      }
      const info: ConsentRequestInfo = {
        clientName: displayName(client),
        redirectHost: new URL(request.redirectUri).host,
        scopes: request.scopes,
        expiresAt: new Date(request.expiresAt).toISOString(),
      };
      res.json(info);
    }),
  );

  router.post(
    "/requests/:id/decision",
    user,
    asyncHandler(async (req, res) => {
      const body = parseBody(consentDecisionRequestSchema, req, res);
      if (!body) return;
      if (!(await pending(req, res))) return;
      // Taking the request deletes it, so each request is decided once.
      const request = await store.takeAuthRequest(String(req.params.id));
      if (!request) {
        res.status(404).json({ error: "expired", message: "This request was already answered." });
        return;
      }
      const { uid } = pageUser(req);
      const target = new URL(request.redirectUri);
      if (body.allow) {
        const code = await provider.issueCode({
          clientId: request.clientId,
          uid,
          redirectUri: request.redirectUri,
          codeChallenge: request.codeChallenge,
          scopes: request.scopes,
          resource: request.resource,
        });
        target.searchParams.set("code", code);
      } else {
        target.searchParams.set("error", "access_denied");
        target.searchParams.set("error_description", "The user denied access");
      }
      if (request.state !== null) target.searchParams.set("state", request.state);
      // RFC 9207: name the issuer, so a client talking to several servers can tell them apart.
      target.searchParams.set("iss", settings.issuer);
      log.info("oauth consent", { uid, clientId: request.clientId, allow: body.allow });
      const response: ConsentDecisionResponse = { redirectTo: target.href };
      res.json(response);
    }),
  );

  router.get(
    "/grants",
    user,
    asyncHandler(async (req, res) => {
      res.json((await store.listGrants(pageUser(req).uid)).map(toGrantInfo));
    }),
  );

  router.delete(
    "/grants/:id",
    user,
    asyncHandler(async (req, res) => {
      const { uid } = pageUser(req);
      const grant = await store.getGrant(String(req.params.id));
      if (!grant || grant.uid !== uid) {
        res.status(404).end();
        return;
      }
      await provider.deleteGrant(grant.id);
      log.info("oauth grant revoked", { uid, clientId: grant.clientId });
      res.status(204).end();
    }),
  );

  return router;
}
