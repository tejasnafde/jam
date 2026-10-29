import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Router, type Request, type Response } from "express";
import { requireMcpAuth, type McpAuthChallenge, type McpAuthenticator } from "../auth/mcpAuth.js";
import type { Logger } from "../logger.js";
import { buildMcpServer } from "../mcp/server.js";
import type { SoundIndex } from "../sounds/soundIndex.js";
import type { SampleStore } from "../store/samples.js";
import type { PrepStore } from "../store/prep.js";
import type { Store } from "../store/types.js";
import { asyncHandler } from "./validate.js";

interface McpRouteDeps {
  store: Store;
  samples: SampleStore;
  sounds: SoundIndex;
  prep: PrepStore;
  authenticators: McpAuthenticator[];
  challenge: McpAuthChallenge;
  log: Logger;
}

/** Stateless mode: no server-initiated stream and no session to delete. */
const methodNotAllowed = (_req: Request, res: Response) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};

export function mcpRouter({ store, samples, sounds, prep, authenticators, challenge, log }: McpRouteDeps) {
  const router = Router();
  const auth = requireMcpAuth(authenticators, challenge);

  router.post(
    "/",
    express.json({ limit: "1mb" }),
    auth,
    asyncHandler(async (req, res) => {
      const principal = req.principal;
      if (!principal) throw new Error("requireMcpAuth did not run");
      const server = buildMcpServer({ uid: principal.uid, store, samples, sounds, prep });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      const body: unknown = req.body;
      const method = typeof body === "object" && body && "method" in body ? String(body.method) : "batch";
      log.info("mcp request", { uid: principal.uid, via: principal.via, clientId: principal.clientId, method });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    }),
  );
  router.get("/", auth, methodNotAllowed);
  router.delete("/", auth, methodNotAllowed);

  return router;
}
