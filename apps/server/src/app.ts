import express, { type NextFunction, type Request, type Response } from "express";
import { personalTokenAuthenticator, type McpAuthenticator } from "./auth/mcpAuth.js";
import { requireUser, type IdTokenVerifier } from "./auth/userAuth.js";
import { errorFields, silentLogger, type Logger } from "./logger.js";
import { audioRouter } from "./routes/audio.js";
import { mcpRouter } from "./routes/mcp.js";
import { planRouter } from "./routes/plan.js";
import { samplesRouter } from "./routes/samples.js";
import { staticRouter } from "./routes/static.js";
import { tokensRouter } from "./routes/tokens.js";
import { versionsRouter } from "./routes/versions.js";
import type { SoundIndex } from "./sounds/soundIndex.js";
import type { SampleBlobs } from "./store/blobs.js";
import type { SampleStore } from "./store/samples.js";
import type { Store } from "./store/types.js";

export interface AppDeps {
  store: Store;
  samples: SampleStore;
  blobs: SampleBlobs;
  sounds: SoundIndex;
  verifyIdToken: IdTokenVerifier;
  /** Extra MCP authenticators (phase 2: OAuth). Personal tokens are always on. */
  extraAuthenticators?: McpAuthenticator[];
  staticDir?: string;
  log?: Logger;
}

export function createApp({
  store,
  samples,
  blobs,
  sounds,
  verifyIdToken,
  extraAuthenticators = [],
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

  const api = express.Router();
  api.use(express.json({ limit: "200kb" }));
  api.use(requireUser(verifyIdToken));
  api.use("/versions", versionsRouter(store));
  api.use("/audio", audioRouter(store));
  api.use("/plan", planRouter(store));
  api.use("/tokens", tokensRouter(store, log));
  api.use("/samples", samplesRouter(samples, blobs, log));
  app.use("/api", api);

  const authenticators = [personalTokenAuthenticator(store, log), ...extraAuthenticators];
  app.use("/mcp", mcpRouter({ store, samples, sounds, authenticators, log }));

  if (staticDir) app.use(staticRouter(staticDir));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    log.error("request failed", { path: req.path, method: req.method, ...errorFields(err) });
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  });

  return app;
}
