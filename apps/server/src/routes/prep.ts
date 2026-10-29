import { prepRequestSchema, type PrepJob, type PrepStatusResponse } from "@jam/shared";
import { Router } from "express";
import { pageUser } from "../auth/userAuth.js";
import { errorFields, type Logger } from "../logger.js";
import type { PrepRunner } from "../prep/runner.js";
import type { PrepStore } from "../store/prep.js";
import { asyncHandler, parseBody } from "./validate.js";

/** Each run takes 4 CPU and 8 GiB, so a user may have only a few in flight. */
export const MAX_ACTIVE_PREP_JOBS = 2;
/** A job that has not finished by then has died (the task timeout is 30 min). */
const STALE_MS = 35 * 60_000;

export const toPrepStatus = ({ status, sampleIds, error }: PrepJob): PrepStatusResponse => ({
  status,
  ...(sampleIds ? { sampleIds } : {}),
  ...(error ? { error } : {}),
});

const isActive = (job: PrepJob, nowMs: number) =>
  (job.status === "queued" || job.status === "running") && nowMs - Date.parse(job.createdAt) < STALE_MS;

export function prepRouter(store: PrepStore, run: PrepRunner, log: Logger, nowMs = () => Date.now()) {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(prepRequestSchema, req, res);
      if (!body) return;
      const { uid } = pageUser(req);
      if (!(await store.sampleExists(uid, body.sampleId))) {
        res.status(404).json({ error: "sample_not_found" });
        return;
      }
      const recent = await store.listJobs(uid, 10);
      if (recent.filter((j) => isActive(j, nowMs())).length >= MAX_ACTIVE_PREP_JOBS) {
        res.status(429).json({ error: "too_many_jobs", message: "Wait for a prep job to finish first." });
        return;
      }
      const job = await store.createJob(uid, body.sampleId, body.ops);
      try {
        await run({ uid, jobId: job.id, sampleId: body.sampleId, ops: body.ops });
      } catch (err) {
        log.error("prep start failed", { uid, jobId: job.id, ...errorFields(err) });
        await store.updateJob(uid, job.id, { status: "failed", error: "Could not start the prep worker." });
        res.status(503).json({ error: "prep_unavailable", message: "Could not start the prep worker." });
        return;
      }
      log.info("prep started", { uid, jobId: job.id, ops: body.ops });
      res.status(202).json({ jobId: job.id });
    }),
  );

  router.get(
    "/:jobId",
    asyncHandler(async (req, res) => {
      const job = await store.getJob(pageUser(req).uid, String(req.params.jobId));
      if (!job) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(toPrepStatus(job));
    }),
  );

  return router;
}
