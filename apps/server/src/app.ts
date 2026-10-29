import express, { type NextFunction, type Request, type Response } from "express";
import { personalTokenAuthenticator, type McpAuthenticator } from "./auth/mcpAuth.js";
import { requireUser, type IdTokenVerifier } from "./auth/userAuth.js";
import { errorFields, silentLogger, type Logger } from "./logger.js";
import { audioRouter } from "./routes/audio.js";
import { mcpRouter } from "./routes/mcp.js";
import { planRouter } from "./routes/plan.js";
import { prepRouter } from "./routes/prep.js";
import { staticRouter } from "./routes/static.js";
import { tokensRouter } from "./routes/tokens.js";
import { versionsRouter } from "./routes/versions.js";
import type { PrepRunner } from "./prep/runner.js";
import type { SoundIndex } from "./sounds/soundIndex.js";
import type { PrepStore } from "./store/prep.js";
import type { Store } from "./store/types.js";

export interface AppDeps {
  store: Store;
  sounds: SoundIndex;
  verifyIdToken: IdTokenVerifier;
  prep: { store: PrepStore; run: PrepRunner };
  /** Extra MCP authenticators (phase 2: OAuth). Personal tokens are always on. */
  extraAuthenticators?: McpAuthenticator[];
  staticDir?: string;
  log?: Logger;
}

export function createApp({
  store,
  sounds,
  verifyIdToken,
  prep,
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
  api.use("/prep", prepRouter(prep.store, prep.run, log));
  app.use("/api", api);

  const authenticators = [personalTokenAuthenticator(store, log), ...extraAuthenticators];
  app.use("/mcp", mcpRouter({ store, sounds, prep: prep.store, authenticators, log }));

  if (staticDir) app.use(staticRouter(staticDir));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    log.error("request failed", { path: req.path, method: req.method, ...errorFields(err) });
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  });

  return app;
}
