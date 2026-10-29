import { PREP_WORKER_STOPPED, SAMPLE_ID, prepRequestSchema, type PrepJob, type PrepStatusResponse } from "@jam/shared";
import { Router } from "express";
import { pageUser } from "../auth/userAuth.js";
import { errorFields, type Logger } from "../logger.js";
import type { PrepRunner } from "../prep/runner.js";
import { withStaleness, type PrepLimits, type PrepRefusal, type PrepStore } from "../store/prep.js";
import type { SampleStore } from "../store/samples.js";
import { asyncHandler, parseBody } from "./validate.js";

/** Each run takes 4 CPU and 8 GiB, so a user may have only a few in flight. */
export const MAX_ACTIVE_PREP_JOBS = 2;
/** All users together. Sign-in is open to any Google account. */
export const MAX_GLOBAL_PREP_JOBS = 6;
/** Jobs one user may start in a rolling 24 h. */
export const MAX_DAILY_PREP_JOBS = 20;

const REFUSALS: Record<PrepRefusal, { error: string; message: string }> = {
  user_busy: { error: "too_many_jobs", message: "Wait for a prep job to finish first." },
  global_busy: { error: "prep_busy", message: "The prep worker is busy. Try again in a few minutes." },
  daily_quota: { error: "daily_quota", message: "You reached the prep limit for today. Try again tomorrow." },
};

export const toPrepStatus = ({ status, sampleIds, error }: PrepJob): PrepStatusResponse => ({
  status,
  ...(sampleIds ? { sampleIds } : {}),
  ...(error ? { error } : {}),
});

export function prepRouter(
  samples: SampleStore,
  store: PrepStore,
  run: PrepRunner,
  log: Logger,
  nowMs = () => Date.now(),
) {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(prepRequestSchema, req, res);
      if (!body) return;
      const { uid } = pageUser(req);
      // SampleStore.get parses the doc, so a broken sample cannot be prepped.
      if (!(await samples.get(uid, body.sampleId))) {
        res.status(404).json({ error: "sample_not_found" });
        return;
      }
      const limits: PrepLimits = {
        perUser: MAX_ACTIVE_PREP_JOBS,
        global: MAX_GLOBAL_PREP_JOBS,
        perDay: MAX_DAILY_PREP_JOBS,
        nowMs: nowMs(),
      };
      const created = await store.createJob(uid, body.sampleId, body.ops, limits);
      if (!created.ok) {
        log.warn("prep refused", { uid, reason: created.reason });
        res.status(429).json(REFUSALS[created.reason]);
        return;
      }
      const { job } = created;
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
      const { uid } = pageUser(req);
      const jobId = String(req.params.jobId);
      const job = SAMPLE_ID.test(jobId) ? await store.getJob(uid, jobId) : null;
      if (!job) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const seen = withStaleness(job, nowMs());
      if (seen !== job) {
        log.warn("prep worker stopped", { uid, jobId, updatedAt: job.updatedAt });
        await store.updateJob(uid, jobId, { status: "failed", error: PREP_WORKER_STOPPED });
      }
      res.json(toPrepStatus(seen));
    }),
  );

  return router;
}
