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
import {
  DEFAULT_SHARE_RATE_LIMITS,
  publicSharesRouter,
  removeSessionShares,
  sharePageRouter,
  sharesRouter,
  type ShareDeps,
  type ShareRateLimits,
} from "./routes/shares.js";
import { staticRouter } from "./routes/static.js";
import { tokensRouter } from "./routes/tokens.js";
import { versionsRouter } from "./routes/versions.js";
import type { PrepRunner } from "./prep/runner.js";
import type { SoundIndex } from "./sounds/soundIndex.js";
import type { SampleBlobs } from "./store/blobs.js";
import type { SampleStore } from "./store/samples.js";
import type { PrepStore } from "./store/prep.js";
import type { ShareStore } from "./store/shares.js";
import type { Store } from "./store/types.js";

export interface AppDeps {
  store: Store;
  samples: SampleStore;
  blobs: SampleBlobs;
  shares: ShareStore;
  /** Rate limits for share links. False turns them off (tests). */
  shareLimits?: ShareRateLimits | false;
  sounds: SoundIndex;
  verifyIdToken: IdTokenVerifier;
  prep: { store: PrepStore; run: PrepRunner };
  /** OAuth settings; the defaults are production's. Tests shorten lifetimes and inject a clock. */
  oauth?: OAuthOptions;
  /** Fetches client metadata documents. Tests inject a fake; production fetches over https. */
  fetchDocument?: DocumentFetcher;
  staticDir?: string;
  log?: Logger;
  /** The clock for the coach cadence and wait_for_change. Tests move it by hand. */
  now?: () => number;
  /** How long wait_for_change sleeps between checks when nothing signals a change. */
  coachPollMs?: number;
}

export function createApp({
  store,
  samples,
  blobs,
  shares,
  shareLimits = DEFAULT_SHARE_RATE_LIMITS,
  sounds,
  verifyIdToken,
  prep,
  oauth: oauthOptions,
  fetchDocument,
  staticDir,
  log = silentLogger,
  now = Date.now,
  coachPollMs,
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

  const shareDeps: ShareDeps = {
    store,
    shares,
    blobs,
    log,
    now,
    publicUrl: oauth.settings.publicUrl,
    edgeSecret: oauth.settings.edgeSecret,
    limits: shareLimits,
    staticDir,
  };
  // Public, no sign-in: the listener page of a share link, its audio and its metadata.
  app.use(sharePageRouter(shareDeps));
  app.use("/api/public/shares", express.json({ limit: "1kb" }), publicSharesRouter(shareDeps));

  const api = express.Router();
  api.use(express.json({ limit: "200kb" }));
  api.use(requireUser(verifyIdToken));
  api.use("/versions", versionsRouter(store, log, now));
  api.use("/audio", audioRouter(store));
  api.use("/plan", planRouter(store));
  api.use(
    "/sessions",
    sessionsRouter(store, now, async (uid, sessionId) => {
      await removeSessionShares(shares, blobs, uid, sessionId);
    }),
  );
  api.use("/tokens", tokensRouter(store, log));
  api.use("/samples", samplesRouter(samples, blobs, log));
  api.use("/shares", sharesRouter(shareDeps));
  api.use("/prep", prepRouter(samples, prep.store, prep.run, log));
  app.use("/api", api);

  const authenticators = [personalTokenAuthenticator(store, log), oauth.authenticator];
  const challenge = { resourceMetadataUrl: oauth.settings.resourceMetadataUrl, scope: oauth.settings.scope };
  app.use(
    "/mcp",
    mcpRouter({
      store,
      samples,
      sounds,
      prep: prep.store,
      authenticators,
      challenge,
      log,
      coach: { now, pollMs: coachPollMs },
    }),
  );

  if (staticDir) app.use(staticRouter(staticDir));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    log.error("request failed", { path: req.path, method: req.method, ...errorFields(err) });
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  });

  return app;
}
