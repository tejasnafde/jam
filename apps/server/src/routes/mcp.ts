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
  coach: { now: () => number; pollMs?: number };
}

/** Between checks in wait_for_change when no Firestore listener fires (session switch, the clock cadence). */
const COACH_POLL_MS = 20_000;

/**
 * wait_for_change holds its request for up to 15 minutes. It answers as an SSE stream: the
 * headers go out at once and the SDK sends a keep-alive comment every 15 s, so no proxy on
 * the way (the Cloudflare Worker, Cloud Run's front end) sees an idle request.
 */
function isLongPoll(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const { method, params } = body as { method?: unknown; params?: { name?: unknown } };
  return method === "tools/call" && params?.name === "wait_for_change";
}

/** Stateless mode: no server-initiated stream and no session to delete. */
const methodNotAllowed = (_req: Request, res: Response) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};

export function mcpRouter({ store, samples, sounds, prep, authenticators, challenge, log, coach }: McpRouteDeps) {
  const clock = { now: coach.now, pollMs: coach.pollMs ?? COACH_POLL_MS };
  const router = Router();
  const auth = requireMcpAuth(authenticators, challenge);

  router.post(
    "/",
    express.json({ limit: "1mb" }),
    auth,
    asyncHandler(async (req, res) => {
      const principal = req.principal;
      if (!principal) throw new Error("requireMcpAuth did not run");
      const server = buildMcpServer({ uid: principal.uid, store, samples, sounds, prep, coach: clock });
      const body: unknown = req.body;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: !isLongPoll(body),
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
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
