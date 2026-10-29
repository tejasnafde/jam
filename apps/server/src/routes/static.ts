import express, { Router } from "express";
import { existsSync } from "node:fs";

/** Serves the built web app, with index.html as the fallback for client routes. */
export function staticRouter(dir: string) {
  const router = Router();
  if (!existsSync(dir)) return router;
  router.use(express.static(dir, { index: "index.html", maxAge: "1h" }));
  // Not for API, MCP or OAuth paths: an unknown /.well-known/* must be a 404, not the page.
  router.get(/^\/(?!api\/|mcp|\.well-known\/|register|token|revoke).*/, (_req, res) => {
    res.set("Cache-Control", "no-cache").sendFile("index.html", { root: dir });
  });
  return router;
}
