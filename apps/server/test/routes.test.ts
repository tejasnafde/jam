import request from "supertest";
import { describe, expect, it } from "vitest";
import { hashToken } from "../src/auth/tokens.js";
import { setup } from "./helpers.js";

describe("versions", () => {
  it("stores versions and collapses identical re-evaluations", async () => {
    const { app, store, asUser, saveCode } = setup();
    await saveCode("alice", 's("bd")');
    const again = await saveCode("alice", 's("bd")');
    expect(again.body.evalCount).toBe(2);
    await saveCode("alice", 's("bd sd")');
    expect(store.versions.get("alice")).toHaveLength(2);
    const latest = await request(app).get("/api/versions/latest").set(asUser("alice")).expect(200);
    expect(latest.body.code).toBe('s("bd sd")');
  });

  it("rejects oversized code", async () => {
    const { app, asUser } = setup();
    await request(app)
      .post("/api/versions")
      .set(asUser("alice"))
      .send({ code: "x".repeat(100_001) })
      .expect(400);
    await request(app).post("/api/versions").set(asUser("alice")).send({}).expect(400);
  });
});

describe("audio", () => {
  it("validates readings", async () => {
    const { app, asUser, store } = setup();
    const bad = { rms: 2, low: 0, mid: 0, high: 0, windowMs: 1 };
    await request(app).post("/api/audio").set(asUser("alice")).send(bad).expect(400);
    const good = { rms: 0.1, low: 0.5, mid: 0.4, high: 0.1, windowMs: 3000 };
    await request(app).post("/api/audio").set(asUser("alice")).send(good).expect(201);
    expect(store.audio.get("alice")?.[0]).toMatchObject({ versionId: null, rms: 0.1 });
  });
});

describe("tokens", () => {
  it("returns the plaintext once and stores only a hash", async () => {
    const { app, store, asUser, mintFor } = setup();
    const token = await mintFor("alice");
    const stored = [...store.tokens.entries()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[0]).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const list = await request(app).get("/api/tokens").set(asUser("alice")).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it("revokes a token, and only its owner can", async () => {
    const { app, asUser, mintFor, mcp } = setup();
    const token = await mintFor("alice");
    const id = hashToken(token);
    await request(app).delete(`/api/tokens/${id}`).set(asUser("bob")).expect(404);
    await request(app).delete(`/api/tokens/${id}`).set(asUser("alice")).expect(204);
    expect((await mcp(token, "tools/list")).status).toBe(401);
  });

  it("caps tokens per user", async () => {
    const { app, asUser, mintFor } = setup();
    for (let i = 0; i < 10; i++) await mintFor("alice");
    await request(app).post("/api/tokens").set(asUser("alice")).send({ label: "one more" }).expect(409);
  });
});

describe("sounds", () => {
  it("lists the default sound names without sign-in", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/sounds").expect(200);
    const names = (res.body as { sounds: { name: string }[] }).sounds.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["sawtooth", "RolandTR808_bd", "bd"]));
  });
});
