import { saveAudioRequestSchema } from "@jam/shared";
import { Router } from "express";
import { pageUser } from "../auth/userAuth.js";
import type { Store } from "../store/types.js";
import { asyncHandler, parseBody } from "./validate.js";

export function audioRouter(store: Store) {
  const router = Router();
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(saveAudioRequestSchema, req, res);
      if (!body) return;
      const saved = await store.saveAudio(pageUser(req).uid, { ...body, versionId: body.versionId ?? null });
      res.status(201).json({ id: saved.id });
    }),
  );
  return router;
}
