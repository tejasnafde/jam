import { Router } from "express";
import { pageUser } from "../auth/userAuth.js";
import type { Store } from "../store/types.js";
import { asyncHandler } from "./validate.js";

/** The page only reads the plan. The coach writes it through MCP. */
export function planRouter(store: Store) {
  const router = Router();
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await store.currentPlan(pageUser(req).uid));
    }),
  );
  return router;
}
