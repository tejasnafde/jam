import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { cloudRunJobRunner } from "../src/prep/runner.js";
import { jsonOf, setup, textOf } from "./helpers.js";

const withSample = (uid: string, id: string) => {
  const ctx = setup();
  ctx.prep.samples.set(uid, new Set([id]));
  return ctx;
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
    const job = await prep.createJob("alice", "s1", { tempo: 90 });
    await prep.updateJob("alice", job.id, { status: "done", sampleIds: ["p1"] });
    const res = await request(app).get(`/api/prep/${job.id}`).set(asUser("alice")).expect(200);
    expect(res.body).toEqual({ status: "done", sampleIds: ["p1"] });
    await request(app).get(`/api/prep/${job.id}`).set(asUser("bob")).expect(404);
  });
});

describe("get_prep_status", () => {
  it("lists the user's recent jobs or one job, and is read-only", async () => {
    const { prep, mintFor, callTool } = setup();
    expect(textOf(await callTool(await mintFor("alice"), "get_prep_status"))).toMatch(/No prep jobs/);
    const a = await prep.createJob("alice", "s1", { split: true });
    await prep.createJob("alice", "s2", { semitones: 3 });
    await prep.createJob("bob", "s9", { split: true });
    const token = await mintFor("alice");
    const before = JSON.stringify([...prep.jobs.entries()]);
    const list = jsonOf<{ sampleId: string }[]>(await callTool(token, "get_prep_status"));
    expect(list.map((j) => j.sampleId)).toEqual(["s2", "s1"]);
    expect(jsonOf(await callTool(token, "get_prep_status", { job_id: a.id }))).toMatchObject({ sampleId: "s1" });
    expect(textOf(await callTool(await mintFor("bob"), "get_prep_status", { job_id: a.id }))).toMatch(/No prep job/);
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
