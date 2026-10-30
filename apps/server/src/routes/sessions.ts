import {
  createSessionRequestSchema,
  duplicateSessionRequestSchema,
  openSessionRequestSchema,
  reportErrorRequestSchema,
  SessionId,
  summarizeChange,
  updateSessionRequestSchema,
  versionPageQuerySchema,
  type SessionListResponse,
  type VersionPage,
} from "@jam/shared";
import { Router, type Request, type Response } from "express";
import { pageUser } from "../auth/userAuth.js";
import type { Store } from "../store/types.js";
import { asyncHandler, parseBody } from "./validate.js";

/** The session id from the path, or a 404. Every session lives under its owner, so another user's id is never found. */
function sessionParam(req: Request, res: Response): string | null {
  const parsed = SessionId.safeParse(req.params.id);
  if (parsed.success) return parsed.data;
  res.status(404).json({ error: "not_found" });
  return null;
}

const notFound = (res: Response) => res.status(404).json({ error: "not_found" });

export function sessionsRouter(store: Store) {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { uid } = pageUser(req);
      // currentSession first: on the first load it makes "Untitled", which the list must include.
      const current = await store.currentSession(uid);
      // Only the open session carries its text: the page reads no other.
      const sessions = (await store.listSessions(uid)).map((s) =>
        s.id === current.id ? { ...s, lastCode: current.lastCode } : s,
      );
      const response: SessionListResponse = { sessions, currentId: current.id };
      res.json(response);
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(createSessionRequestSchema, req, res);
      if (!body) return;
      res.status(201).json(await store.createSession(pageUser(req).uid, body));
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = sessionParam(req, res);
      const body = id && parseBody(updateSessionRequestSchema, req, res);
      if (!id || !body) return;
      const session = await store.updateSession(pageUser(req).uid, id, body);
      if (!session) return notFound(res);
      res.json(session);
    }),
  );

  router.post(
    "/:id/open",
    asyncHandler(async (req, res) => {
      const id = sessionParam(req, res);
      const body = id && parseBody(openSessionRequestSchema, req, res);
      if (!id || !body) return;
      const { uid } = pageUser(req);
      const session = await store.openSession(uid, id, body.previous);
      if (!session) return notFound(res);
      res.json({ session, plan: await store.currentPlan(uid, id) });
    }),
  );

  router.post(
    "/:id/duplicate",
    asyncHandler(async (req, res) => {
      const id = sessionParam(req, res);
      const body = id && parseBody(duplicateSessionRequestSchema, req, res);
      if (!id || !body) return;
      const { uid } = pageUser(req);
      const source = await store.getSession(uid, id);
      if (!source) return notFound(res);
      const name = body.name ?? `${source.name} copy`.slice(0, 60);
      const copy = await store.duplicateSession(uid, id, name);
      if (!copy) return notFound(res);
      res.status(201).json(copy);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = sessionParam(req, res);
      if (!id) return;
      if (!(await store.deleteSession(pageUser(req).uid, id))) return notFound(res);
      res.status(204).end();
    }),
  );

  // An evaluation failed: kept as the session's lastError (one, overwritten) so the coach can see it.
  router.post(
    "/:id/error",
    asyncHandler(async (req, res) => {
      const id = sessionParam(req, res);
      const body = id && parseBody(reportErrorRequestSchema, req, res);
      if (!id || !body) return;
      const saved = await store.setSessionError(pageUser(req).uid, id, { ...body, at: new Date().toISOString() });
      if (!saved) return notFound(res);
      res.status(204).end();
    }),
  );

  router.get(
    "/:id/versions",
    asyncHandler(async (req, res) => {
      const id = sessionParam(req, res);
      if (!id) return;
      const query = versionPageQuerySchema.safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "invalid_request", issues: query.error.issues });
      const { uid } = pageUser(req);
      if (!(await store.getSession(uid, id))) return notFound(res);
      const { limit, before } = query.data;
      // One extra: the oldest shown version needs the one before it for its summary.
      const rows = await store.listVersions(uid, limit + 1, { sessionId: id, before });
      const shown = rows.slice(0, limit);
      const response: VersionPage = {
        versions: shown.map((v, i) => ({
          id: v.id,
          code: v.code,
          createdAt: v.createdAt,
          evaluatedAt: v.evaluatedAt,
          evalCount: v.evalCount,
          summary: summarizeChange(rows[i + 1]?.code ?? null, v.code),
        })),
        nextBefore: rows.length > limit ? (shown.at(-1)?.createdAt ?? null) : null,
      };
      res.json(response);
    }),
  );

  return router;
}
