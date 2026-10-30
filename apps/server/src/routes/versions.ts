import { saveVersionRequestSchema, type SaveVersionResponse } from "@jam/shared";
import { Router } from "express";
import { pageUser } from "../auth/userAuth.js";
import type { Store } from "../store/types.js";
import { asyncHandler, parseBody } from "./validate.js";

export function versionsRouter(store: Store) {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(saveVersionRequestSchema, req, res);
      if (!body) return;
      const user = pageUser(req);
      const version = await store.saveVersion(user.uid, body.code, { email: user.email, sessionId: body.sessionId });
      if (!version) return res.status(404).json({ error: "not_found", message: "That session does not exist." });
      const response: SaveVersionResponse = {
        id: version.id,
        evalCount: version.evalCount,
        sessionId: version.sessionId ?? null,
      };
      res.status(201).json(response);
    }),
  );

  router.get(
    "/latest",
    asyncHandler(async (req, res) => {
      res.json(await store.latestVersion(pageUser(req).uid));
    }),
  );

  return router;
}
