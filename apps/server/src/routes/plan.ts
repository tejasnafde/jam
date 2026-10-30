import { SessionId } from "@jam/shared";
import { Router } from "express";
import { pageUser } from "../auth/userAuth.js";
import type { Store } from "../store/types.js";
import { asyncHandler } from "./validate.js";

/**
 * The page only reads the plan. The coach writes it through MCP. `?session=` names the session
 * the page shows, so a tab never shows the plan of a session another tab evaluated in.
 */
export function planRouter(store: Store) {
  const router = Router();
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const session = req.query.session === undefined ? undefined : SessionId.safeParse(req.query.session);
      if (session && !session.success) return res.status(400).json({ error: "invalid_request" });
      res.json(await store.currentPlan(pageUser(req).uid, session?.data));
    }),
  );
  return router;
}
