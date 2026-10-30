import express, { type NextFunction, type Request, type Response } from "express";
import { personalTokenAuthenticator } from "./auth/mcpAuth.js";
import { requireUser, type IdTokenVerifier } from "./auth/userAuth.js";
import { errorFields, silentLogger, type Logger } from "./logger.js";
import { createOAuth, type OAuthOptions } from "./oauth/index.js";
import type { DocumentFetcher } from "./oauth/metadataDocument.js";
import { audioRouter } from "./routes/audio.js";
import { mcpRouter } from "./routes/mcp.js";
import { planRouter } from "./routes/plan.js";
import { prepRouter } from "./routes/prep.js";
import { samplesRouter } from "./routes/samples.js";
import { sessionsRouter } from "./routes/sessions.js";
import { staticRouter } from "./routes/static.js";
import { tokensRouter } from "./routes/tokens.js";
import { versionsRouter } from "./routes/versions.js";
import type { PrepRunner } from "./prep/runner.js";
import type { SoundIndex } from "./sounds/soundIndex.js";
import type { SampleBlobs } from "./store/blobs.js";
import type { SampleStore } from "./store/samples.js";
import type { PrepStore } from "./store/prep.js";
import type { Store } from "./store/types.js";

export interface AppDeps {
  store: Store;
  samples: SampleStore;
  blobs: SampleBlobs;
  sounds: SoundIndex;
  verifyIdToken: IdTokenVerifier;
  prep: { store: PrepStore; run: PrepRunner };
  /** OAuth settings; the defaults are production's. Tests shorten lifetimes and inject a clock. */
  oauth?: OAuthOptions;
  /** Fetches client metadata documents. Tests inject a fake; production fetches over https. */
  fetchDocument?: DocumentFetcher;
  staticDir?: string;
  log?: Logger;
}

export function createApp({
  store,
  samples,
  blobs,
  sounds,
  verifyIdToken,
  prep,
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

  // Public: Strudel's default sound names, for the Sounds browser when the page cannot read Strudel's map.
  app.get("/api/sounds", async (_req, res, next) => {
    try {
      res.set("Cache-Control", "public, max-age=3600");
      res.json({ sounds: await sounds.all() });
    } catch (err) {
      next(err);
    }
  });

  const api = express.Router();
  api.use(express.json({ limit: "200kb" }));
  api.use(requireUser(verifyIdToken));
  api.use("/versions", versionsRouter(store));
  api.use("/audio", audioRouter(store));
  api.use("/plan", planRouter(store));
  api.use("/sessions", sessionsRouter(store));
  api.use("/tokens", tokensRouter(store, log));
  api.use("/samples", samplesRouter(samples, blobs, log));
  api.use("/prep", prepRouter(samples, prep.store, prep.run, log));
  app.use("/api", api);

  const authenticators = [personalTokenAuthenticator(store, log), oauth.authenticator];
  const challenge = { resourceMetadataUrl: oauth.settings.resourceMetadataUrl, scope: oauth.settings.scope };
  app.use("/mcp", mcpRouter({ store, samples, sounds, prep: prep.store, authenticators, challenge, log }));

  if (staticDir) app.use(staticRouter(staticDir));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    log.error("request failed", { path: req.path, method: req.method, ...errorFields(err) });
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  });

  return app;
}
