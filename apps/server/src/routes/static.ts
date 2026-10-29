import express, { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

/** Serves the built web app, with index.html as the fallback for client routes. */
export function staticRouter(dir: string) {
  const router = Router();
  if (!existsSync(dir)) return router;
  router.use(express.static(dir, { index: "index.html", maxAge: "1h" }));
  router.get(/^\/(?!api\/|mcp).*/, (_req, res) => {
    res.set("Cache-Control", "no-cache").sendFile(path.join(dir, "index.html"));
  });
  return router;
}
