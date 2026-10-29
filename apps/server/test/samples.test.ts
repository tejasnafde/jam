import { SAMPLE_MAX_BYTES, type Sample } from "@jam/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { MemorySampleStore, SampleNameTaken } from "../src/store/samples.js";
import { jsonOf, setup, textOf } from "./helpers.js";

type Ctx = ReturnType<typeof setup>;

/** The page's flow: ask for an upload URL, PUT the file, register it. */
async function addSample(ctx: Ctx, uid: string, name: string, extra: Partial<Sample> = {}) {
  const { app, asUser, blobs } = ctx;
  const up = await request(app)
    .post("/api/samples/upload-url")
    .set(asUser(uid))
    .send({ name, contentType: "audio/wav" })
    .expect(200);
  blobs.put(up.body.storagePath, 1000);
  return request(app)
    .post("/api/samples")
    .set(asUser(uid))
    .send({
      id: up.body.id,
      name,
      kind: "take",
      storagePath: up.body.storagePath,
      contentType: "audio/wav",
      durationSec: 3.2,
      ...extra,
    });
}

describe("samples API", () => {
  it("uploads, registers, lists with signed URLs and deletes", async () => {
    const ctx = setup();
    const { app, asUser, blobs } = ctx;
    const created = await addSample(ctx, "alice", "mytake", { bpm: 92, key: "F# minor" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ userId: "alice", name: "mytake", ops: [], bpm: 92 });
    expect(created.body.storagePath).toBe(`users/alice/samples/${created.body.id}.wav`);

    const list = await request(app).get("/api/samples").set(asUser("alice")).expect(200);
    expect(list.body.samples).toHaveLength(1);
    expect(list.body.samples[0].url).toContain("?get");

    await request(app).delete(`/api/samples/${created.body.id}`).set(asUser("alice")).expect(204);
    expect(blobs.objects.size).toBe(0);
    expect((await request(app).get("/api/samples").set(asUser("alice"))).body.samples).toEqual([]);
  });

  it("keeps samples private to their owner", async () => {
    const ctx = setup();
    const { app, asUser } = ctx;
    const created = await addSample(ctx, "alice", "mytake");
    expect((await request(app).get("/api/samples").set(asUser("bob"))).body.samples).toEqual([]);
    await request(app).delete(`/api/samples/${created.body.id}`).set(asUser("bob")).expect(404);
    await request(app).get("/api/samples").expect(401);
  });

  it("refuses to register another user's object", async () => {
    const ctx = setup();
    const { app, asUser, blobs } = ctx;
    const up = await request(app)
      .post("/api/samples/upload-url")
      .set(asUser("alice"))
      .send({ name: "mine", contentType: "audio/wav" })
      .expect(200);
    blobs.put(up.body.storagePath, 10);
    const body = {
      id: up.body.id,
      name: "stolen",
      kind: "upload",
      storagePath: up.body.storagePath,
      contentType: "audio/wav",
      durationSec: 1,
    };
    await request(app).post("/api/samples").set(asUser("bob")).send(body).expect(400);
  });

  it("validates names, uniqueness, missing and oversized uploads", async () => {
    const ctx = setup();
    const { app, asUser, blobs } = ctx;
    await request(app)
      .post("/api/samples/upload-url")
      .set(asUser("alice"))
      .send({ name: "Bad Name", contentType: "audio/wav" })
      .expect(400);
    await request(app)
      .post("/api/samples/upload-url")
      .set(asUser("alice"))
      .send({ name: "ok", contentType: "video/mp4" })
      .expect(400);
    await addSample(ctx, "alice", "dupe");
    await request(app)
      .post("/api/samples/upload-url")
      .set(asUser("alice"))
      .send({ name: "dupe", contentType: "audio/wav" })
      .expect(409);

    const up = await request(app)
      .post("/api/samples/upload-url")
      .set(asUser("alice"))
      .send({ name: "big", contentType: "audio/mpeg" })
      .expect(200);
    const body = { id: up.body.id, name: "big", kind: "upload", storagePath: up.body.storagePath };
    const reg = () =>
      request(app)
        .post("/api/samples")
        .set(asUser("alice"))
        .send({ ...body, contentType: "audio/mpeg", durationSec: 1 });
    expect((await reg()).body.error).toBe("not_uploaded");
    blobs.put(up.body.storagePath, SAMPLE_MAX_BYTES + 1);
    expect((await reg()).status).toBe(413);
    expect(blobs.objects.has(up.body.storagePath)).toBe(false);
  });
});

describe("MemorySampleStore", () => {
  it("scopes by user and keeps names unique per user", async () => {
    const store = new MemorySampleStore();
    const base = { kind: "take", storagePath: "p", contentType: "audio/wav", durationSec: 1, ops: [] } as const;
    await store.create({ ...base, id: "a", userId: "u1", name: "kick", createdAt: "2026-01-01" });
    await store.create({ ...base, id: "b", userId: "u2", name: "kick", createdAt: "2026-01-01" });
    await store.create({ ...base, id: "c", userId: "u1", name: "snare", createdAt: "2026-01-02" });
    await expect(
      store.create({ ...base, id: "d", userId: "u1", name: "kick", createdAt: "2026-01-03" }),
    ).rejects.toBeInstanceOf(SampleNameTaken);
    expect((await store.list("u1")).map((s) => s.id)).toEqual(["c", "a"]);
    expect(await store.get("u2", "a")).toBeNull();
    expect(await store.delete("u2", "a")).toBe(false);
    expect((await store.findByName("u2", "kick"))?.id).toBe("b");
  });
});

describe("sample tools", () => {
  it("lists and gets the caller's samples, without storage paths", async () => {
    const ctx = setup();
    const parent = await addSample(ctx, "alice", "song", { kind: "upload", bpm: 120, key: "A minor" });
    await addSample(ctx, "alice", "song_vocals", { kind: "stem", stem: "vocals", parentId: parent.body.id });
    await addSample(ctx, "bob", "bobs");
    const token = await ctx.mintFor("alice");

    const list = jsonOf<{ name: string; storagePath?: string; usage: string }[]>(
      await ctx.callTool(token, "list_samples"),
    );
    expect(list.map((s) => s.name).sort()).toEqual(["song", "song_vocals"]);
    expect(list[0]?.storagePath).toBeUndefined();
    expect(list[0]?.usage).toMatch(/^s\("song/);

    const song = jsonOf(await ctx.callTool(token, "get_sample", { name: "song" }));
    expect(song).toMatchObject({ bpm: 120, key: "A minor", children: ["song_vocals"] });
    expect(textOf(await ctx.callTool(token, "get_sample", { name: "bobs" }))).toMatch(/No sample/);
    expect(textOf(await ctx.callTool(await ctx.mintFor("carol"), "list_samples"))).toMatch(/empty/);
  });
});
