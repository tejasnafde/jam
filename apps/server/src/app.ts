import express, { type NextFunction, type Request, type Response } from "express";
import { personalTokenAuthenticator } from "./auth/mcpAuth.js";
import { requireUser, type IdTokenVerifier } from "./auth/userAuth.js";
import { errorFields, silentLogger, type Logger } from "./logger.js";
import { createOAuth, type OAuthOptions } from "./oauth/index.js";
import type { DocumentFetcher } from "./oauth/metadataDocument.js";
import { audioRouter } from "./routes/audio.js";
import { mcpRouter } from "./routes/mcp.js";
import { planRouter } from "./routes/plan.js";
import { staticRouter } from "./routes/static.js";
import { tokensRouter } from "./routes/tokens.js";
import { versionsRouter } from "./routes/versions.js";
import type { SoundIndex } from "./sounds/soundIndex.js";
import type { Store } from "./store/types.js";

export interface AppDeps {
  store: Store;
  sounds: SoundIndex;
  verifyIdToken: IdTokenVerifier;
  /** OAuth settings; the defaults are production's. Tests shorten lifetimes and inject a clock. */
  oauth?: OAuthOptions;
  /** Fetches client metadata documents. Tests inject a fake; production fetches over https. */
  fetchDocument?: DocumentFetcher;
  staticDir?: string;
  log?: Logger;
}

export function createApp({
  store,
  sounds,
  verifyIdToken,
  oauth: oauthOptions,
  fetchDocument,
  staticDir,
  log = silentLogger,
}: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  // Not /healthz: Google's front end reserves that path on Cloud Run and answers 404 itself.
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const oauth = createOAuth({ store, verifyIdToken, log, staticDir, options: oauthOptions, fetchDocument });
  app.use(oauth.routes);
  // Before the /api router: reading a consent request needs no user, only the browser cookie.
  app.use("/api/oauth", oauth.consent);

  const api = express.Router();
  api.use(express.json({ limit: "200kb" }));
  api.use(requireUser(verifyIdToken));
  api.use("/versions", versionsRouter(store));
  api.use("/audio", audioRouter(store));
  api.use("/plan", planRouter(store));
  api.use("/tokens", tokensRouter(store, log));
  app.use("/api", api);

  const authenticators = [personalTokenAuthenticator(store, log), oauth.authenticator];
  const challenge = { resourceMetadataUrl: oauth.settings.resourceMetadataUrl, scope: oauth.settings.scope };
  app.use("/mcp", mcpRouter({ store, sounds, authenticators, challenge, log }));

  if (staticDir) app.use(staticRouter(staticDir));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    log.error("request failed", { path: req.path, method: req.method, ...errorFields(err) });
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  });

  return app;
}
