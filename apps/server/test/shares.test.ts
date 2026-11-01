import { SHARE_LIMITS, sharePath } from "@jam/shared";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { downloadName, sharePageHtml } from "../src/routes/shares.js";
import type { ShareRecord } from "../src/store/shares.js";
import { setup } from "./helpers.js";

type Ctx = ReturnType<typeof setup>;

const INDEX = `<!doctype html><html><head><title>jam</title>
<meta
  name="description"
  content="Live-code music."
/></head><body><div id="root"></div></body></html>`;

async function sessionWithVersion(ctx: Ctx, uid: string) {
  await ctx.saveCode(uid, 'setcpm(30)\n$: s("bd*4")');
  const session = await ctx.store.currentSession(uid);
  const version = await ctx.store.latestVersion(uid, session.id);
  if (!version) throw new Error("no version");
  return { sessionId: session.id, versionId: version.id, code: version.code };
}

const body = (ids: { sessionId: string; versionId: string }, extra: Record<string, unknown> = {}) => ({
  ...ids,
  title: "schranz v0",
  ownerName: "Tejas",
  bars: 24,
  seconds: 38.4,
  ...extra,
});

const PEAKS = Array.from({ length: SHARE_LIMITS.peaks }, (_, i) => (i % 10) / 10);

/** The page's flow: start the share, PUT the file, finish it with the waveform. */
async function share(ctx: Ctx, uid: string, extra: Record<string, unknown> = {}, bytes = 5000) {
  const ids = await sessionWithVersion(ctx, uid);
  const started = await request(ctx.app).post("/api/shares").set(ctx.asUser(uid)).send(body(ids, extra)).expect(201);
  ctx.blobs.put(sharePath(started.body.id), bytes);
  const ready = await request(ctx.app)
    .post(`/api/shares/${started.body.id}/ready`)
    .set(ctx.asUser(uid))
    .send({ peaks: PEAKS });
  return { ids, started, ready };
}

function seedActive(ctx: Ctx, uid: string, n: number) {
  for (let i = 0; i < n; i++) {
    const id = `seed${String(i).padStart(6, "0")}`;
    const record: ShareRecord = {
      id,
      uid,
      sessionId: "s",
      versionId: "v",
      title: "t",
      ownerName: "A",
      asOf: "2026-10-31T00:00:00.000Z",
      bars: 8,
      seconds: 10,
      showCode: false,
      code: null,
      storagePath: sharePath(id),
      enabled: true,
      ready: true,
      createdAt: "2026-10-31T00:00:00.000Z",
      plays: 0,
    };
    ctx.shares.shares.set(id, record);
  }
}

describe("share links", () => {
  it("creates a frozen share: upload URL, then ready, then listed for the owner", async () => {
    const ctx = setup();
    const { ids, started, ready } = await share(ctx, "alice");
    expect(started.body.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(started.body.url).toBe(`https://jam.tn07.dev/s/${started.body.id}`);
    expect(started.body.uploadUrl).toContain(encodeURIComponent(`0,${SHARE_LIMITS.maxBytes}`));
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ enabled: true, plays: 0, bars: 24, versionId: ids.versionId, showCode: false });
    expect(ready.body).not.toHaveProperty("uid");
    expect(ready.body).not.toHaveProperty("storagePath");
    expect(ready.body).not.toHaveProperty("peaks");

    // Later edits do not change it: the stored code and version stay.
    await ctx.saveCode("alice", '$: s("hh*8")');
    const list = await request(ctx.app).get("/api/shares").set(ctx.asUser("alice")).expect(200);
    expect(list.body.shares).toHaveLength(1);
    expect(list.body.shares[0].versionId).toBe(ids.versionId);
    expect(ctx.shares.shares.get(started.body.id)?.code).toBeNull();
  });

  it("stores the code only when showCode is on", async () => {
    const ctx = setup();
    const { ids, started } = await share(ctx, "alice", { showCode: true });
    expect(ctx.shares.shares.get(started.body.id)?.code).toBe(ids.code);
  });

  it("checks the owner on every route", async () => {
    const ctx = setup();
    const { ids, started } = await share(ctx, "alice");
    const id = started.body.id as string;
    // Bob cannot share Alice's session, finish, change or list her share.
    await request(ctx.app).post("/api/shares").set(ctx.asUser("bob")).send(body(ids)).expect(404);
    await request(ctx.app).post(`/api/shares/${id}/ready`).set(ctx.asUser("bob")).expect(404);
    await request(ctx.app).patch(`/api/shares/${id}`).set(ctx.asUser("bob")).send({ enabled: false }).expect(404);
    expect((await request(ctx.app).get("/api/shares").set(ctx.asUser("bob"))).body.shares).toEqual([]);
    await request(ctx.app).get("/api/shares").expect(401);
  });

  it("refuses a stale version, a missing upload and an oversized file", async () => {
    const ctx = setup();
    const ids = await sessionWithVersion(ctx, "alice");
    await ctx.saveCode("alice", '$: s("cp")');
    const stale = await request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("stale_version");

    const fresh = await sessionWithVersion(ctx, "alice");
    const started = await request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(fresh)).expect(201);
    await request(ctx.app).post(`/api/shares/${started.body.id}/ready`).set(ctx.asUser("alice")).expect(400);
    ctx.blobs.put(sharePath(started.body.id), SHARE_LIMITS.maxBytes + 1);
    await request(ctx.app).post(`/api/shares/${started.body.id}/ready`).set(ctx.asUser("alice")).expect(413);
    expect(ctx.blobs.objects.has(sharePath(started.body.id))).toBe(false);
    // A share that never got ready is not listed.
    expect((await request(ctx.app).get("/api/shares").set(ctx.asUser("alice"))).body.shares).toEqual([]);
  });

  it("deletes a link with its file, for the owner only", async () => {
    const ctx = setup();
    const { started } = await share(ctx, "alice");
    const id = started.body.id as string;
    await request(ctx.app).delete(`/api/shares/${id}`).set(ctx.asUser("bob")).expect(404);
    await request(ctx.app).delete(`/api/shares/${id}`).set(ctx.asUser("alice")).expect(204);
    expect(ctx.blobs.objects.has(sharePath(id))).toBe(false);
    expect(ctx.shares.shares.has(id)).toBe(false);
    await request(ctx.app).get(`/api/public/shares/${id}`).expect(404);
    // A cancelled recording deletes its unfinished share the same way.
    const ids = await sessionWithVersion(ctx, "alice");
    const pending = await request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids)).expect(201);
    await request(ctx.app).delete(`/api/shares/${pending.body.id}`).set(ctx.asUser("alice")).expect(204);
    expect(ctx.shares.shares.size).toBe(0);
  });

  it("deleting a session deletes its links and their files, and keeps the links of other sessions", async () => {
    const ctx = setup();
    const kept = await share(ctx, "alice");
    const keptId = kept.started.body.id as string;
    const other = await request(ctx.app)
      .post("/api/sessions")
      .set(ctx.asUser("alice"))
      .send({ name: "Second" })
      .expect(201);
    await request(ctx.app).post(`/api/sessions/${other.body.id}/open`).set(ctx.asUser("alice")).send({}).expect(200);
    const gone = await share(ctx, "alice");
    const goneId = gone.started.body.id as string;
    expect(gone.ids.sessionId).toBe(other.body.id);

    await request(ctx.app).delete(`/api/sessions/${other.body.id}`).set(ctx.asUser("alice")).expect(204);
    expect(ctx.shares.shares.has(goneId)).toBe(false);
    expect(ctx.blobs.objects.has(sharePath(goneId))).toBe(false);
    await request(ctx.app).get(`/api/public/shares/${goneId}`).expect(404);
    await request(ctx.app).get(`/s/${goneId}/audio.wav`).expect(404);
    expect(ctx.shares.shares.has(keptId)).toBe(true);
    await request(ctx.app).get(`/api/public/shares/${keptId}`).expect(200);
    const list = await request(ctx.app).get("/api/shares").set(ctx.asUser("alice"));
    expect(list.body.shares.map((s: { id: string }) => s.id)).toEqual([keptId]);
  });

  it("caps unfinished links and sweeps the ones older than an hour, with their files", async () => {
    const ctx = setup();
    const ids = await sessionWithVersion(ctx, "alice");
    const start = () => request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids));
    const first = await start().expect(201);
    ctx.blobs.put(sharePath(first.body.id), 100);
    for (let i = 1; i < SHARE_LIMITS.pendingPerUser; i++) await start().expect(201);
    const refused = await start();
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("pending_limit");

    ctx.clock.advance(SHARE_LIMITS.pendingTtlMs + 1000);
    await start().expect(201);
    expect(ctx.shares.shares.has(first.body.id)).toBe(false);
    expect(ctx.blobs.objects.has(sharePath(first.body.id))).toBe(false);
    expect([...ctx.shares.shares.values()].filter((s) => !s.ready)).toHaveLength(1);
  });

  it("validates bars and length", async () => {
    const ctx = setup();
    const ids = await sessionWithVersion(ctx, "alice");
    const send = (extra: Record<string, unknown>) =>
      request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids, extra));
    await send({ bars: 0 }).expect(400);
    await send({ bars: 257 }).expect(400);
    await send({ seconds: SHARE_LIMITS.maxSeconds + 1 }).expect(400);
    await send({ title: "" }).expect(400);
  });

  it("allows at most 50 links on, and counts only the ones on", async () => {
    const ctx = setup();
    seedActive(ctx, "alice", SHARE_LIMITS.activePerUser);
    const ids = await sessionWithVersion(ctx, "alice");
    const refused = await request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("share_limit");

    // Turning one off makes room; turning it back on while full is refused.
    await request(ctx.app)
      .patch("/api/shares/seed000000")
      .set(ctx.asUser("alice"))
      .send({ enabled: false })
      .expect(200);
    const { ready } = await share(ctx, "alice");
    expect(ready.status).toBe(200);
    const again = await request(ctx.app)
      .patch("/api/shares/seed000000")
      .set(ctx.asUser("alice"))
      .send({ enabled: true });
    expect(again.status).toBe(409);
  });

  it("rate limits share creation per user", async () => {
    const ctx = setup({ shareLimits: { createMax: 2, createWindowMs: 60_000, publicPerMinute: 100 } });
    const ids = await sessionWithVersion(ctx, "alice");
    const send = () => request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids));
    await send().expect(201);
    await send().expect(201);
    expect((await send()).status).toBe(429);
    // Another user has their own budget.
    const bobIds = await sessionWithVersion(ctx, "bob");
    await request(ctx.app).post("/api/shares").set(ctx.asUser("bob")).send(body(bobIds)).expect(201);
  });
});

describe("public share route", () => {
  const text = (value: unknown) => JSON.stringify(value);

  it("returns metadata and the waveform with no uid, session, storage path or signed URL", async () => {
    const ctx = setup();
    const { started } = await share(ctx, "alice");
    const res = await request(ctx.app).get(`/api/public/shares/${started.body.id}`).expect(200);
    expect(res.body).toMatchObject({ title: "schranz v0", ownerName: "Tejas", bars: 24, seconds: 38.4, code: null });
    expect(res.body.peaks).toEqual(PEAKS);
    // No signed URL in the JSON: the player and Download ask the audio route for a fresh one.
    expect(text(res.body)).not.toContain("storage.test");
    expect(text(res.body)).not.toContain("alice");
    for (const key of ["uid", "sessionId", "versionId", "storagePath", "plays", "enabled"]) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  it("shows the code only when the owner chose it", async () => {
    const ctx = setup();
    const { ids, started } = await share(ctx, "alice", { showCode: true });
    const res = await request(ctx.app).get(`/api/public/shares/${started.body.id}`).expect(200);
    expect(res.body.code).toBe(ids.code);
  });

  it("respects enabled: a turned-off link stops, and works again when turned on", async () => {
    const ctx = setup();
    const { started } = await share(ctx, "alice");
    const id = started.body.id as string;
    await request(ctx.app).post(`/api/public/shares/${id}/plays`).expect(204);
    await request(ctx.app).patch(`/api/shares/${id}`).set(ctx.asUser("alice")).send({ enabled: false }).expect(200);

    const off = await request(ctx.app).get(`/api/public/shares/${id}`).expect(404);
    expect(off.body.error).toBe("off");
    await request(ctx.app).post(`/api/public/shares/${id}/plays`).expect(404);
    await request(ctx.app).get(`/s/${id}/audio.wav`).expect(404);
    // The file is kept.
    expect(ctx.blobs.objects.has(sharePath(id))).toBe(true);

    await request(ctx.app).patch(`/api/shares/${id}`).set(ctx.asUser("alice")).send({ enabled: true }).expect(200);
    await request(ctx.app).get(`/api/public/shares/${id}`).expect(200);
    const list = await request(ctx.app).get("/api/shares").set(ctx.asUser("alice"));
    expect(list.body.shares[0].plays).toBe(1);
  });

  it("answers the same for a missing id, an unfinished share and a bad id", async () => {
    const ctx = setup();
    const ids = await sessionWithVersion(ctx, "alice");
    const started = await request(ctx.app).post("/api/shares").set(ctx.asUser("alice")).send(body(ids)).expect(201);
    for (const id of ["AAAAAAAAAA", started.body.id, "../x", "short"]) {
      const res = await request(ctx.app).get(`/api/public/shares/${encodeURIComponent(id)}`);
      expect(res.status).toBe(404);
    }
  });

  it("redirects the audio to a fresh signed URL, as an attachment for download", async () => {
    const ctx = setup();
    const { started } = await share(ctx, "alice");
    const play = await request(ctx.app).get(`/s/${started.body.id}/audio.wav`).expect(302);
    expect(play.headers.location).toBe(`https://storage.test/shares/${started.body.id}.wav?get`);
    const save = await request(ctx.app).get(`/s/${started.body.id}/audio.wav?download`).expect(302);
    expect(save.headers.location).toContain("download=schranz-v0.wav");
    // The same under /api, which the listener page uses (and the dev server proxies).
    const api = await request(ctx.app).get(`/api/public/shares/${started.body.id}/audio?download`).expect(302);
    expect(api.headers.location).toContain("download=schranz-v0.wav");
    await request(ctx.app).get("/api/public/shares/AAAAAAAAAA/audio").expect(404);
  });

  it("rate limits the public routes per client", async () => {
    const ctx = setup({ shareLimits: { createMax: 10, createWindowMs: 60_000, publicPerMinute: 3 } });
    const { started } = await share(ctx, "alice");
    const get = () => request(ctx.app).get(`/api/public/shares/${started.body.id}`);
    await get().expect(200);
    await get().expect(200);
    await get().expect(200);
    expect((await get()).status).toBe(429);
  });
});

describe("share page", () => {
  const withIndex = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jam-share-"));
    writeFileSync(path.join(dir, "index.html"), INDEX);
    return setup({ staticDir: dir });
  };

  it("server-renders the link preview tags", async () => {
    const ctx = withIndex();
    const { started } = await share(ctx, "alice", { title: 'Night <drive> "2"' });
    const res = await request(ctx.app).get(`/s/${started.body.id}`).expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<title>Night &#60;drive&#62; &#34;2&#34; - jam</title>");
    expect(res.text).toContain('<meta property="og:description" content="A 0:38 jam by Tejas" />');
    expect(res.text).toContain(
      `<meta property="og:audio" content="https://jam.tn07.dev/s/${started.body.id}/audio.wav" />`,
    );
    expect(res.text).toContain('<meta property="og:image" content="https://jam.tn07.dev/og.png" />');
    expect(res.text).toContain('<div id="root">');
    expect(res.text).not.toContain("alice");
    expect(res.text.match(/name="description"/g)).toHaveLength(1);
  });

  it("serves the page with a turned-off preview for a missing or disabled share", async () => {
    const ctx = withIndex();
    const res = await request(ctx.app).get("/s/AAAAAAAAAA").expect(404);
    expect(res.text).toContain("This link is turned off");
    expect(res.text).not.toContain("og:audio");
    expect(res.text).toContain('<div id="root">');
  });

  it("keeps a $ in the title as text, not a replacement pattern", async () => {
    const ctx = withIndex();
    const { started } = await share(ctx, "alice", { title: "Cash $$ flow $' $&" });
    const res = await request(ctx.app).get(`/s/${started.body.id}`).expect(200);
    expect(res.text).toContain("<title>Cash $$ flow $&#39; $&#38; - jam</title>");
    expect(res.text).toContain('<meta property="og:title" content="Cash $$ flow $&#39; $&#38;" />');
    expect(res.text.match(/<\/head>/g)).toHaveLength(1);
    expect(res.text.match(/<div id="root">/g)).toHaveLength(1);
  });

  it("builds tags without a built web app", () => {
    const html = sharePageHtml("<html><head><title>jam</title></head></html>", {
      title: "a",
      description: "b",
      url: "u",
      imageUrl: "i",
    });
    expect(html).toContain('<meta property="og:title" content="a" />');
  });

  it("names downloads after the title", () => {
    expect(downloadName("schranz v0")).toBe("schranz-v0.wav");
    expect(downloadName("!!!")).toBe("jam.wav");
  });
});
