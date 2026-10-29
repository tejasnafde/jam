import { PREP_STALE_MS, type PrepJob, type Sample } from "@jam/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { cloudRunJobRunner } from "../src/prep/runner.js";
import { MAX_DAILY_PREP_JOBS, MAX_GLOBAL_PREP_JOBS } from "../src/routes/prep.js";
import type { PrepLimits } from "../src/store/prep.js";
import { jsonOf, setup, textOf } from "./helpers.js";

const sampleOf = (uid: string, id: string): Sample => ({
  id,
  userId: uid,
  name: `song_${id}`,
  kind: "upload",
  storagePath: `users/${uid}/samples/${id}.mp3`,
  contentType: "audio/mpeg",
  durationSec: 30,
  ops: [],
  createdAt: new Date().toISOString(),
});

const withSample = (uid: string, id: string) => {
  const ctx = setup();
  ctx.samples.samples.set(id, sampleOf(uid, id));
  return ctx;
};

const LIMITS: PrepLimits = { perUser: 2, global: 6, perDay: 20, nowMs: Date.now() };

/** Moves a job's updatedAt back, as if its worker went quiet that long ago. */
const age = (job: PrepJob | undefined, ms: number) => {
  if (!job) throw new Error("no job");
  job.updatedAt = new Date(Date.now() - ms).toISOString();
};

describe("POST /api/prep", () => {
  it("creates a queued job and starts the worker with the job's env", async () => {
    const { app, asUser, prep, runs } = withSample("alice", "s1");
    const res = await request(app)
      .post("/api/prep")
      .set(asUser("alice"))
      .send({ sampleId: "s1", ops: { split: true, tempo: 120, semitones: -2 } })
      .expect(202);
    const jobId = res.body.jobId as string;
    expect(runs).toEqual([{ uid: "alice", jobId, sampleId: "s1", ops: { split: true, tempo: 120, semitones: -2 } }]);
    expect(prep.jobs.get("alice")?.[0]).toMatchObject({ id: jobId, status: "queued", sampleId: "s1" });
  });

  it("validates ops and needs at least one", async () => {
    const { app, asUser, runs } = withSample("alice", "s1");
    const post = (body: object) => request(app).post("/api/prep").set(asUser("alice")).send(body);
    await post({ sampleId: "s1", ops: {} }).expect(400);
    await post({ sampleId: "s1", ops: { semitones: 0 } }).expect(400);
    await post({ sampleId: "s1", ops: { tempo: 300 } }).expect(400);
    await post({ sampleId: "s1", ops: { semitones: 1.5 } }).expect(400);
    await post({ sampleId: "s1", ops: { semitones: 13 } }).expect(400);
    await post({ ops: { split: true } }).expect(400);
    expect(runs).toHaveLength(0);
  });

  it("refuses another user's sample", async () => {
    const { app, asUser, runs } = withSample("alice", "s1");
    await request(app)
      .post("/api/prep")
      .set(asUser("bob"))
      .send({ sampleId: "s1", ops: { split: true } })
      .expect(404);
    expect(runs).toHaveLength(0);
  });

  it("needs a signed-in user", async () => {
    const { app } = withSample("alice", "s1");
    await request(app)
      .post("/api/prep")
      .send({ sampleId: "s1", ops: { split: true } })
      .expect(401);
  });

  it("caps jobs in flight per user", async () => {
    const { app, asUser, prep } = withSample("alice", "s1");
    const post = () =>
      request(app)
        .post("/api/prep")
        .set(asUser("alice"))
        .send({ sampleId: "s1", ops: { split: true } });
    const first = await post().expect(202);
    await post().expect(202);
    await post().expect(429);
    await prep.updateJob("alice", first.body.jobId as string, { status: "done" });
    await post().expect(202);
  });

  it("lets only the cap through when requests race", async () => {
    const { app, asUser, runs } = withSample("alice", "s1");
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post("/api/prep")
          .set(asUser("alice"))
          .send({ sampleId: "s1", ops: { split: true } }),
      ),
    );
    expect(results.filter((r) => r.status === 202)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(8);
    expect(runs).toHaveLength(2);
  });

  it("caps jobs in flight across all users", async () => {
    const ctx = setup();
    const users = Array.from({ length: MAX_GLOBAL_PREP_JOBS + 1 }, (_, i) => `u${i}`);
    for (const uid of users) ctx.samples.samples.set(`s_${uid}`, sampleOf(uid, `s_${uid}`));
    const post = (uid: string) =>
      request(ctx.app)
        .post("/api/prep")
        .set(ctx.asUser(uid))
        .send({ sampleId: `s_${uid}`, ops: { split: true } });
    for (const uid of users.slice(0, -1)) await post(uid).expect(202);
    const res = await post(users.at(-1) ?? "").expect(429);
    expect(res.body.error).toBe("prep_busy");
  });

  it("caps jobs per user per day", async () => {
    const { app, asUser, prep } = withSample("alice", "s1");
    for (let i = 0; i < MAX_DAILY_PREP_JOBS; i++) {
      const made = await prep.createJob("alice", "s1", { split: true }, LIMITS);
      if (!made.ok) throw new Error(made.reason);
      await prep.updateJob("alice", made.job.id, { status: "done" });
    }
    const res = await request(app)
      .post("/api/prep")
      .set(asUser("alice"))
      .send({ sampleId: "s1", ops: { split: true } })
      .expect(429);
    expect(res.body.error).toBe("daily_quota");
  });

  it("does not count a stale job against the cap", async () => {
    const { app, asUser, prep } = withSample("alice", "s1");
    const post = () =>
      request(app)
        .post("/api/prep")
        .set(asUser("alice"))
        .send({ sampleId: "s1", ops: { split: true } });
    await post().expect(202);
    await post().expect(202);
    await post().expect(429);
    age(prep.jobs.get("alice")?.[0], PREP_STALE_MS + 1000);
    await post().expect(202);
  });

  it("refuses a sampleId that is not a plain doc id", async () => {
    const { app, asUser, runs } = withSample("alice", "s1");
    for (const sampleId of ["", "a/b", "../s1", "x".repeat(65)]) {
      await request(app)
        .post("/api/prep")
        .set(asUser("alice"))
        .send({ sampleId, ops: { split: true } })
        .expect(400);
    }
    expect(runs).toHaveLength(0);
  });

  it("takes a confirmed source tempo with a tempo only", async () => {
    const { app, asUser, runs } = withSample("alice", "s1");
    const post = (ops: object) => request(app).post("/api/prep").set(asUser("alice")).send({ sampleId: "s1", ops });
    await post({ sourceBpm: 60 }).expect(400);
    await post({ split: true, sourceBpm: 60 }).expect(400);
    await post({ tempo: 90, sourceBpm: 10 }).expect(400);
    await post({ tempo: 90, sourceBpm: 60 }).expect(202);
    expect(runs[0]?.ops).toEqual({ tempo: 90, sourceBpm: 60 });
  });

  it("marks the job failed when the worker cannot start", async () => {
    const { app, asUser, prep, runner } = withSample("alice", "s1");
    runner.fail = true;
    await request(app)
      .post("/api/prep")
      .set(asUser("alice"))
      .send({ sampleId: "s1", ops: { split: true } })
      .expect(503);
    expect(prep.jobs.get("alice")?.[0]?.status).toBe("failed");
  });
});

describe("GET /api/prep/:jobId", () => {
  it("returns the contract status, to the owner only", async () => {
    const { app, asUser, prep } = withSample("alice", "s1");
    const made = await prep.createJob("alice", "s1", { tempo: 90 }, LIMITS);
    if (!made.ok) throw new Error(made.reason);
    const job = made.job;
    await prep.updateJob("alice", job.id, { status: "done", sampleIds: ["p1"] });
    const res = await request(app).get(`/api/prep/${job.id}`).set(asUser("alice")).expect(200);
    expect(res.body).toEqual({ status: "done", sampleIds: ["p1"] });
    await request(app).get(`/api/prep/${job.id}`).set(asUser("bob")).expect(404);
  });

  it("reports a job whose worker went quiet as failed, and saves that", async () => {
    const { app, asUser, prep } = withSample("alice", "s1");
    const made = await prep.createJob("alice", "s1", { split: true }, LIMITS);
    if (!made.ok) throw new Error(made.reason);
    await prep.updateJob("alice", made.job.id, { status: "running" });
    const get = () => request(app).get(`/api/prep/${made.job.id}`).set(asUser("alice")).expect(200);
    expect((await get()).body).toEqual({ status: "running" });
    age(prep.jobs.get("alice")?.[0], PREP_STALE_MS + 1000);
    expect((await get()).body).toEqual({ status: "failed", error: "The prep worker stopped." });
    expect(prep.jobs.get("alice")?.[0]).toMatchObject({ status: "failed", error: "The prep worker stopped." });
  });

  it("answers 404 for a job id with a path in it", async () => {
    const { app, asUser } = withSample("alice", "s1");
    await request(app).get("/api/prep/a%2Fb").set(asUser("alice")).expect(404);
    await request(app).get("/api/prep/..").set(asUser("alice")).expect(404);
  });
});

describe("get_prep_status", () => {
  it("lists the user's recent jobs or one job, and is read-only", async () => {
    const { prep, mintFor, callTool } = setup();
    expect(textOf(await callTool(await mintFor("alice"), "get_prep_status"))).toMatch(/No prep jobs/);
    const made = await prep.createJob("alice", "s1", { split: true }, LIMITS);
    if (!made.ok) throw new Error(made.reason);
    const a = made.job;
    await prep.createJob("alice", "s2", { semitones: 3 }, LIMITS);
    await prep.createJob("bob", "s9", { split: true }, LIMITS);
    const token = await mintFor("alice");
    const before = JSON.stringify([...prep.jobs.entries()]);
    const list = jsonOf<{ sampleId: string }[]>(await callTool(token, "get_prep_status"));
    expect(list.map((j) => j.sampleId)).toEqual(["s2", "s1"]);
    expect(jsonOf(await callTool(token, "get_prep_status", { job_id: a.id }))).toMatchObject({ sampleId: "s1" });
    expect(textOf(await callTool(await mintFor("bob"), "get_prep_status", { job_id: a.id }))).toMatch(/No prep job/);
    expect(JSON.stringify([...prep.jobs.entries()])).toBe(before);
  });

  it("shows a dead worker's job as failed without a write", async () => {
    const { prep, mintFor, callTool } = setup();
    const made = await prep.createJob("alice", "s1", { split: true }, LIMITS);
    if (!made.ok) throw new Error(made.reason);
    age(prep.jobs.get("alice")?.[0], PREP_STALE_MS + 1000);
    const before = JSON.stringify([...prep.jobs.entries()]);
    const token = await mintFor("alice");
    expect(jsonOf(await callTool(token, "get_prep_status", { job_id: made.job.id }))).toMatchObject({
      status: "failed",
      error: "The prep worker stopped.",
    });
    expect(jsonOf<{ status: string }[]>(await callTool(token, "get_prep_status"))[0]?.status).toBe("failed");
    expect(JSON.stringify([...prep.jobs.entries()])).toBe(before);
  });
});

describe("cloudRunJobRunner", () => {
  it("calls jobs.run with env overrides and throws on an HTTP error", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const run = cloudRunJobRunner({
      project: "p",
      region: "r",
      job: "jam-prep",
      getAccessToken: async () => "tok",
      fetch,
    });
    await run({ uid: "u", jobId: "j", sampleId: "s", ops: { tempo: 100 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://run.googleapis.com/v2/projects/p/locations/r/jobs/jam-prep:run");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "JAM_UID", value: "u" },
              { name: "JAM_JOB_ID", value: "j" },
              { name: "JAM_SAMPLE_ID", value: "s" },
              { name: "JAM_OPS", value: '{"tempo":100}' },
            ],
          },
        ],
      },
    });
    fetch.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(run({ uid: "u", jobId: "j", sampleId: "s", ops: {} })).rejects.toThrow(/403/);
  });
});
