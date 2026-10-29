import { createTokenRequestSchema, LIMITS, type CreateTokenResponse, type TokenInfo } from "@jam/shared";
import { Router } from "express";
import { hashToken, mintToken } from "../auth/tokens.js";
import { pageUser } from "../auth/userAuth.js";
import type { Logger } from "../logger.js";
import type { Store, TokenRecord } from "../store/types.js";
import { asyncHandler, parseBody } from "./validate.js";

const toInfo = ({ id, label, createdAt, lastUsedAt }: TokenRecord): TokenInfo => ({ id, label, createdAt, lastUsedAt });

export function tokensRouter(store: Store, log: Logger) {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json((await store.listTokens(pageUser(req).uid)).map(toInfo));
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(createTokenRequestSchema, req, res);
      if (!body) return;
      const { uid } = pageUser(req);
      const existing = await store.listTokens(uid);
      if (existing.length >= LIMITS.tokensPerUser) {
        res
          .status(409)
          .json({ error: "too_many_tokens", message: `Revoke a key first (max ${LIMITS.tokensPerUser}).` });
        return;
      }
      const token = mintToken();
      const record = await store.createToken(hashToken(token), uid, body.label);
      log.info("token created", { uid, label: record.label });
      // The only time the plaintext token leaves the server.
      const response: CreateTokenResponse = { ...toInfo(record), token };
      res.status(201).json(response);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const { uid } = pageUser(req);
      const deleted = await store.deleteToken(uid, String(req.params.id));
      if (deleted) log.info("token revoked", { uid });
      res.status(deleted ? 204 : 404).end();
    }),
  );

  return router;
}
