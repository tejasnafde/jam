import type { Session, SessionListResponse, VersionPage } from "@jam/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { jsonOf, setup, textOf } from "./helpers.js";

const stages = [1, 2, 3, 4].map((n) => ({ title: `Stage ${n}`, goal: `Goal ${n}` }));

function api(ctx: ReturnType<typeof setup>, uid = "alice") {
  const { app, asUser } = ctx;
  const as = asUser(uid);
  return {
    list: async () =>
      (await request(app).get("/api/sessions").set(as).expect(200)).body as SessionListResponse,
    create: async (name: string, lastCode = "") =>
      (await request(app).post("/api/sessions").set(as).send({ name, lastCode }).expect(201)).body as Session,
    open: (id: string, previous?: { id: string; lastCode: string }) =>
      request(app).post(`/api/sessions/${id}/open`).set(as).send({ previous }),
    patch: (id: string, body: object) => request(app).patch(`/api/sessions/${id}`).set(as).send(body),
    duplicate: (id: string) => request(app).post(`/api/sessions/${id}/duplicate`).set(as).send({}),
    remove: (id: string) => request(app).delete(`/api/sessions/${id}`).set(as),
    versions: (id: string, query = "") => request(app).get(`/api/sessions/${id}/versions${query}`).set(as),
    save: (code: string, sessionId?: string) => request(app).post("/api/versions").set(as).send({ code, sessionId }),
  };
}

describe("sessions: Untitled fallback", () => {
  it("makes an Untitled session on first load that claims old versions and the old plan", async () => {
    const ctx = setup();
    const { store } = ctx;
    // Data from before sessions: no sessionId anywhere.
    store.versions.set("alice", [
      { id: "v2", code: "new", createdAt: "2026-01-02", evaluatedAt: "2026-01-02", evalCount: 1 },
      { id: "v1", code: "old", createdAt: "2026-01-01", evaluatedAt: "2026-01-01", evalCount: 1 },
    ]);
    store.plans.set("alice", [{ id: "p1", destination: "d", stages, currentStage: 2, createdAt: "", updatedAt: "" }]);
    const list = await api(ctx).list();
    expect(list.currentId).toBe("untitled");
    expect(list.sessions).toEqual([
      expect.objectContaining({ id: "untitled", name: "Untitled", lastCode: "new", versionCount: 2, planId: "p1" }),
    ]);
    expect(store.versions.get("alice")?.every((v) => v.sessionId === "untitled")).toBe(true);
    const plan = await request(ctx.app).get("/api/plan").set(ctx.asUser("alice")).expect(200);
    expect(plan.body.currentStage).toBe(2);
    // A second load makes nothing new.
    expect((await api(ctx).list()).sessions).toHaveLength(1);
  });

  it("gives a version without a session to the open one", async () => {
    const ctx = setup();
    await ctx.saveCode("alice", 's("bd")');
    const list = await api(ctx).list();
    expect(list.sessions[0]).toMatchObject({ name: "Untitled", versionCount: 1, lastCode: 's("bd")' });
  });
});

describe("sessions: CRUD", () => {
  it("creates, opens, renames, duplicates and deletes", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const rain = await a.create("Rainy loop", 's("hh*4")');
    let list = await a.list();
    expect(list.currentId).toBe(rain.id);
    expect(list.sessions.map((s) => s.name)).toEqual(["Rainy loop", "Untitled"]);

    const renamed = await a.patch(rain.id, { name: "  Night rain " }).expect(200);
    expect(renamed.body.name).toBe("Night rain");
    await a.patch(rain.id, { name: "" }).expect(400);
    await a.patch(rain.id, {}).expect(400);

    const opened = await a.open("untitled").expect(200);
    expect(opened.body.session.id).toBe("untitled");
    expect((await a.list()).currentId).toBe("untitled");

    const copy = await a.duplicate(rain.id).expect(201);
    expect(copy.body).toMatchObject({ name: "Night rain copy", lastCode: 's("hh*4")', versionCount: 0 });
    expect((await a.list()).currentId).toBe("untitled");

    await a.remove(rain.id).expect(204);
    await a.remove(rain.id).expect(404);
    list = await a.list();
    expect(list.sessions.map((s) => s.name).sort()).toEqual(["Night rain copy", "Untitled"]);
  });

  it("deletes a session's versions, and picks another session when the open one goes", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const s = await a.create("Doomed");
    await a.save("x", s.id).expect(201);
    await a.remove(s.id).expect(204);
    expect(ctx.store.versions.get("alice")?.some((v) => v.sessionId === s.id)).toBe(false);
    expect((await a.list()).currentId).toBe("untitled");
  });

  it("checks the owner on every route", async () => {
    const ctx = setup();
    await api(ctx).list();
    const mine = await api(ctx).create("Mine", "secret()");
    const bob = api(ctx, "bob");
    await bob.patch(mine.id, { name: "Stolen" }).expect(404);
    await bob.open(mine.id).expect(404);
    await bob.duplicate(mine.id).expect(404);
    await bob.remove(mine.id).expect(404);
    await bob.versions(mine.id).expect(404);
    await bob.save("bob's", mine.id).expect(404);
    // Bob leaving "his" session with Alice's id as the previous one does not touch hers.
    await bob.list();
    await bob.open("untitled", { id: mine.id, lastCode: "overwritten" }).expect(200);
    expect((await ctx.store.getSession("alice", mine.id))?.lastCode).toBe("secret()");
    expect((await bob.list()).sessions.map((s) => s.name)).toEqual(["Untitled"]);
    await request(ctx.app).get("/api/sessions").expect(401);
  });

  it("rejects ids that are not doc ids", async () => {
    const ctx = setup();
    await api(ctx).patch("a.b", { name: "x" }).expect(404);
    await api(ctx).save("x", "../etc").expect(400);
  });
});

describe("sessions: versions", () => {
  it("assigns each version to its session and keeps lastCode and the count", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const one = await a.create("One");
    const two = await a.create("Two");
    expect((await a.save("a", one.id).expect(201)).body.sessionId).toBe(one.id);
    await a.save("a", one.id).expect(201); // the same code again: a counter bump, not a row
    await a.save("b", two.id).expect(201);
    await a.save("c", one.id).expect(201);
    const list = await a.list();
    const byName = Object.fromEntries(list.sessions.map((s) => [s.name, s]));
    expect(byName.One).toMatchObject({ versionCount: 2, lastCode: "c" });
    expect(byName.Two).toMatchObject({ versionCount: 1, lastCode: "b" });
    // The version just saved belongs to the session that is open now.
    expect(list.currentId).toBe(one.id);
  });

  it("pages versions newest first with a one-line summary", async () => {
    const ctx = setup();
    const a = api(ctx);
    const { currentId } = await a.list();
    const codes = ["// hi\ns('bd')", "// hi\ns('bd sd')", "// hi\ns('bd sd')\nnote('c')", "// hi\nnote('c')"];
    for (const code of codes) await a.save(code, currentId).expect(201);
    const first = (await a.versions(currentId, "?limit=2").expect(200)).body as VersionPage;
    expect(first.versions.map((v) => v.summary)).toEqual(["removed: s('bd sd')", "note('c')"]);
    expect(first.nextBefore).not.toBeNull();
    const rest = (await a.versions(currentId, `?limit=2&before=${encodeURIComponent(first.nextBefore ?? "")}`))
      .body as VersionPage;
    expect(rest.versions.map((v) => v.summary)).toEqual(["s('bd sd')", "s('bd')"]);
    expect(rest.versions[1]?.code).toBe(codes[0]);
    expect(rest.nextBefore).toBeNull();
    await a.versions(currentId, "?limit=500").expect(400);
  });
});

describe("sessions: switch saves lastCode", () => {
  it("keeps the unsaved editor text of the session the user leaves", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const one = await a.create("One", "start");
    const two = await a.create("Two", "other");
    await a.open(one.id, { id: two.id, lastCode: "typed but never evaluated" }).expect(200);
    expect((await ctx.store.getSession("alice", two.id))?.lastCode).toBe("typed but never evaluated");
    // Opening returns the text to load; it is not evaluated, so no version is made.
    const back = await a.open(two.id, { id: one.id, lastCode: "start" }).expect(200);
    expect(back.body.session.lastCode).toBe("typed but never evaluated");
    expect(ctx.store.versions.get("alice") ?? []).toHaveLength(0);
  });

  it("saves a draft with PATCH lastCode", async () => {
    const ctx = setup();
    const a = api(ctx);
    const { currentId } = await a.list();
    await a.patch(currentId, { lastCode: "draft" }).expect(200);
    expect((await a.list()).sessions[0]?.lastCode).toBe("draft");
  });
});

describe("sessions: plan per session", () => {
  it("each session brings back its own plan", async () => {
    const ctx = setup();
    const a = api(ctx);
    const token = await ctx.mintFor("alice");
    await a.list();
    const one = await a.create("One");
    await ctx.callTool(token, "set_session_plan", { destination: "plan one", stages });
    const two = await a.create("Two");
    const getPlan = async () => (await request(ctx.app).get("/api/plan").set(ctx.asUser("alice"))).body;
    expect(await getPlan()).toBeNull();
    const saved = await ctx.callTool(token, "set_session_plan", { destination: "plan two", stages });
    expect(jsonOf(saved).session).toBe("Two");
    await ctx.callTool(token, "set_stage", { stage: 3 });
    expect((await a.open(one.id).expect(200)).body.plan.destination).toBe("plan one");
    expect((await getPlan()).destination).toBe("plan one");
    expect((await getPlan()).currentStage).toBe(0);
    const back = (await a.open(two.id).expect(200)).body.plan;
    expect(back).toMatchObject({ destination: "plan two", currentStage: 3 });
  });

  it("copies the plan when a session is duplicated", async () => {
    const ctx = setup();
    const a = api(ctx);
    const { currentId } = await a.list();
    await ctx.callTool(await ctx.mintFor("alice"), "set_session_plan", { destination: "keep me", stages });
    const copy = (await a.duplicate(currentId).expect(201)).body as Session;
    expect(copy.planId).not.toBeNull();
    expect((await a.open(copy.id).expect(200)).body.plan.destination).toBe("keep me");
  });
});

describe("sessions: MCP", () => {
  it("list_sessions lists names, counts and last edits", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const beat = await a.create("Beat");
    await a.save("s('bd')", beat.id);
    await a.save("s('bd sd')", beat.id);
    const token = await ctx.mintFor("alice");
    const sessions = jsonOf<{ name: string; versionCount: number; lastEdited: string; open: boolean }[]>(
      await ctx.callTool(token, "list_sessions"),
    );
    expect(sessions).toEqual([
      { name: "Beat", versionCount: 2, lastEdited: expect.any(String), open: true },
      { name: "Untitled", versionCount: 0, lastEdited: expect.any(String), open: false },
    ]);
  });

  it("get_current_code and get_history name the session; get_history takes a session name", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const beat = await a.create("Beat");
    await a.save("s('bd')", beat.id);
    const pad = await a.create("Pad");
    await a.save("note('c')", pad.id);
    const token = await ctx.mintFor("alice");
    expect(jsonOf(await ctx.callTool(token, "get_current_code"))).toMatchObject({ session: "Pad", code: "note('c')" });
    const other = jsonOf<{ session: string; versions: { code: string }[] }>(
      await ctx.callTool(token, "get_history", { session: "beat", include_diffs: false }),
    );
    expect(other).toEqual({ session: "Beat", versions: [expect.objectContaining({ code: "s('bd')" })] });
    const missing = await ctx.callTool(token, "get_history", { session: "Nope" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('"Beat"');
  });

  it("set_session_plan writes the plan of the open session only", async () => {
    const ctx = setup();
    const a = api(ctx);
    await a.list();
    const other = await a.create("Other");
    await a.open("untitled");
    await ctx.callTool(await ctx.mintFor("alice"), "set_session_plan", { destination: "here", stages });
    expect((await ctx.store.getSession("alice", other.id))?.planId).toBeNull();
    expect((await ctx.store.currentPlan("alice", "untitled"))?.destination).toBe("here");
  });
});

describe("MemoryStore sessions", () => {
  it("returns null for a version in a session that does not exist", async () => {
    const store = new MemoryStore();
    expect(await store.saveVersion("u", "x", { sessionId: "nope" })).toBeNull();
  });
});
