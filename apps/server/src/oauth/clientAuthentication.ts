import express, { Router, type Response } from "express";
import type { JamClientsStore } from "./clients.js";
import { secretMatches } from "./secrets.js";

type Basic = { id: string; secret: string } | "malformed" | null;

/** RFC 6749 2.3.1: Basic credentials, each part form-urlencoded. */
function parseBasic(header: string | undefined): Basic {
  const match = header ? /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header) : null;
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1) return "malformed";
  try {
    const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
    return { id: decode(decoded.slice(0, colon)), secret: decode(decoded.slice(colon + 1)) };
  } catch {
    return "malformed";
  }
}

function fail(res: Response, status: number, error: string, description: string) {
  res
    .status(status)
    .set({ "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" })
    .json({ error, error_description: description });
}

/**
 * Client authentication for /token and /revoke, in front of the SDK handlers.
 * Accepts `none`, `client_secret_post` and `client_secret_basic`, and checks a
 * secret against its stored hash. The SDK's own check compares plaintext, so
 * the clients store never hands it a secret; this middleware is the check.
 * It leaves `client_id` in the body for the SDK and removes the secret.
 */
export function clientAuthentication(clients: JamClientsStore) {
  const router = Router();
  router.post("/", express.urlencoded({ extended: false, limit: "16kb" }), (req, res, next) => {
    void (async () => {
      const body: Record<string, unknown> = typeof req.body === "object" && req.body ? { ...req.body } : {};
      let clientId = typeof body.client_id === "string" ? body.client_id : undefined;
      let secret = typeof body.client_secret === "string" ? body.client_secret : undefined;
      const basic = parseBasic(req.headers.authorization);
      if (basic === "malformed") return fail(res, 401, "invalid_client", "Malformed Basic credentials");
      if (basic) {
        if (clientId !== undefined && clientId !== basic.id) {
          return fail(res, 400, "invalid_request", "client_id in the body and the header differ");
        }
        if (secret !== undefined) return fail(res, 400, "invalid_request", "Use one client authentication method");
        clientId = basic.id;
        secret = basic.secret;
      }
      // With no client_id, or an unknown one, the SDK handler answers with the right error.
      const record = clientId === undefined ? null : await clients.getRecord(clientId);
      if (record?.clientSecretHash && (!secret || !secretMatches(secret, record.clientSecretHash))) {
        return fail(res, 401, "invalid_client", "Client authentication failed");
      }
      delete body.client_secret;
      if (clientId !== undefined) body.client_id = clientId;
      req.body = body;
      next();
    })().catch(next);
  });
  return router;
}
