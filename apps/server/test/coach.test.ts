import {
  advanceCadence,
  COACH_EVERY_MS,
  DEFAULT_CADENCE_STATE,
  type CoachCadenceState,
  type CoachThread,
} from "@jam/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { jsonOf, setup, textOf } from "./helpers.js";

const T0 = Date.parse("2026-10-30T12:00:00Z");
const MIN = 60_000;

describe("advanceCadence", () => {
  const runs15: CoachCadenceState = { ...DEFAULT_CADENCE_STATE, cadence: "runs15" };
  const minutes10: CoachCadenceState = { ...DEFAULT_CADENCE_STATE, cadence: "minutes10" };

  it("never fires when the user only asks", () => {
    let state = DEFAULT_CADENCE_STATE;
    for (let i = 0; i < 100; i++) {
      const next = advanceCadence(state, T0 + i * MIN, true);
      expect(next.due).toBeNull();
      state = next.state;
    }
  });

  it("fires on every 15th run, then counts again", () => {
    let state = runs15;
    const fired: number[] = [];
    for (let i = 1; i <= 45; i++) {
      const next = advanceCadence(state, T0 + i * 1000, true);
      if (next.due) fired.push(i);
      state = next.state;
    }
    expect(fired).toEqual([15, 30, 45]);
  });

  it("fires 10 minutes after the first run of a window, on a run or on the clock alone", () => {
    let { state, due } = advanceCadence(minutes10, T0, true);
    expect(due).toBeNull();
    ({ state, due } = advanceCadence(state, T0 + 9 * MIN, true));
    expect(due).toBeNull();
    // No run: the clock alone (a waiting coach) finds it due.
    ({ state, due } = advanceCadence(state, T0 + COACH_EVERY_MS, false));
    expect(due).toBe("minutes");
    // A new window has no run yet, so the clock alone does not fire.
    expect(advanceCadence(state, T0 + 30 * MIN, false).due).toBeNull();
  });

  it("does not fire on the first run after a pause: that run opens a new window", () => {
    let { state } = advanceCadence(minutes10, T0, true);
    ({ state } = advanceCadence(state, T0 + COACH_EVERY_MS, false));
    const back = advanceCadence(state, T0 + 60 * MIN, true);
    expect(back.due).toBeNull();
    expect(advanceCadence(back.state, T0 + 70 * MIN, true).due).toBe("minutes");
  });
});

/** Calls wait_for_change. It answers as an SSE stream, so read the last data line. */
async function waitFor(app: Parameters<typeof request>[0], token: string, args: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("Authorization", `Bearer ${token}`)
    .buffer(true)
    .parse((r, done) => {
      let text = "";
      r.setEncoding("utf8");
      r.on("data", (chunk: string) => (text += chunk));
      r.on("end", () => done(null, text));
    })
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_change", arguments: args } });
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  const data = String(res.body)
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .at(-1);
  const result = (
    JSON.parse(data?.slice(6) ?? "{}") as { result: { content: { type: string; text: string }[]; isError?: boolean } }
  ).result;
  return result;
}

function coachSetup() {
  const ctx = setup();
  const thread = async (uid: string, sessionId = "untitled") =>
    (await request(ctx.app).get(`/api/sessions/${sessionId}/coach`).set(ctx.asUser(uid)).expect(200))
      .body as CoachThread;
  const ask = (uid: string, text: string, sessionId = "untitled") =>
    request(ctx.app).post(`/api/sessions/${sessionId}/coach/asks`).set(ctx.asUser(uid)).send({ text });
  const cadence = (uid: string, value: string, sessionId = "untitled") =>
    request(ctx.app).put(`/api/sessions/${sessionId}/coach/cadence`).set(ctx.asUser(uid)).send({ cadence: value });
  return { ...ctx, thread, ask, cadence };
}

describe("coach cadence through the page API", () => {
  it("adds one check-in every 15 runs, and none by default", async () => {
    const { saveCode, thread, cadence } = coachSetup();
    for (let i = 0; i < 20; i++) await saveCode("alice", `s("bd*${i}")`);
    expect((await thread("alice")).events).toHaveLength(0);
    expect((await thread("alice")).cadence).toBe("ask");

    await cadence("alice", "runs15").expect(204);
    for (let i = 0; i < 14; i++) await saveCode("alice", `s("hh*${i}")`);
    expect((await thread("alice")).events).toHaveLength(0);
    await saveCode("alice", 's("hh*15")');
    const t = await thread("alice");
    expect(t.cadence).toBe("runs15");
    expect(t.events).toMatchObject([{ kind: "checkin", reason: "runs", status: "pending" }]);
  });

  it("keeps one pending check-in while no coach takes it", async () => {
    const { saveCode, thread, cadence } = coachSetup();
    await saveCode("alice", "a");
    await cadence("alice", "runs15").expect(204);
    for (let i = 0; i < 45; i++) await saveCode("alice", `s("x${i}")`);
    expect((await thread("alice")).events.filter((e) => e.kind === "checkin")).toHaveLength(1);
  });

  it("adds a check-in 10 minutes into a window with a run", async () => {
    const { saveCode, thread, cadence, clock } = coachSetup();
    await saveCode("alice", "a");
    await cadence("alice", "minutes10").expect(204);
    await saveCode("alice", "b");
    clock.advance(5 * MIN);
    await saveCode("alice", "c");
    expect((await thread("alice")).events).toHaveLength(0);
    clock.advance(5 * MIN);
    await saveCode("alice", "d");
    expect((await thread("alice")).events).toMatchObject([{ kind: "checkin", reason: "minutes" }]);
  });

  it("rejects an unknown cadence and a long ask", async () => {
    const { saveCode, cadence, ask } = coachSetup();
    await saveCode("alice", "a");
    await cadence("alice", "always").expect(400);
    await ask("alice", "x".repeat(601)).expect(400);
  });
});

describe("wait_for_change", () => {
  it("returns a pending ask with the code, error, audio and plan, and marks it taken", async () => {
    const { app, asUser, saveCode, mintFor, callTool, ask, thread } = coachSetup();
    await saveCode("alice", 's("bd sd")');
    await request(app)
      .post("/api/sessions/untitled/error")
      .set(asUser("alice"))
      .send({ code: 's("bd sd").oops()', message: "oops is not a function" })
      .expect(204);
    await request(app)
      .post("/api/audio")
      .set(asUser("alice"))
      .send({ versionId: null, rms: 0.2, low: 0.5, mid: 0.3, high: 0.2, windowMs: 3000 })
      .expect(201);
    const token = await mintFor("alice");
    const stages = [1, 2, 3, 4].map((i) => ({ title: `S${i}`, goal: `G${i}` }));
    await callTool(token, "set_session_plan", { destination: "Rain", stages });
    await ask("alice", "Why is the kick so quiet?").expect(201);

    const got = jsonOf<{
      event: { kind: string; text: string; meaning: string };
      code: { code: string };
      lastError: { message: string };
      audio: { rms: number };
      plan: { currentStage: number; stage: { title: string } };
    }>(await waitFor(app, token));
    expect(got.event).toMatchObject({ kind: "ask", text: "Why is the kick so quiet?" });
    expect(got.code.code).toBe('s("bd sd")');
    expect(got.lastError.message).toBe("oops is not a function");
    expect(got.audio.rms).toBe(0.2);
    expect(got.plan).toMatchObject({ currentStage: 0, stage: { title: "S1" } });
    const t = await thread("alice");
    expect(t.events).toMatchObject([{ kind: "ask", status: "taken" }]);
    expect(t.listeningAt).not.toBeNull();
  });

  it("explains an empty ask as Check my music, and takes events oldest first", async () => {
    const { app, saveCode, mintFor, ask } = coachSetup();
    await saveCode("alice", "a");
    await ask("alice", "").expect(201);
    await ask("alice", "second").expect(201);
    const token = await mintFor("alice");
    const first = jsonOf<{ event: { text: string; meaning: string } }>(await waitFor(app, token));
    expect(first.event.meaning).toMatch(/Check my music/);
    expect(jsonOf<{ event: { text: string } }>(await waitFor(app, token)).event.text).toBe("second");
  });

  it("wakes up when an ask arrives during the wait", async () => {
    const { app, saveCode, mintFor, ask, store } = coachSetup();
    await saveCode("alice", "a");
    const token = await mintFor("alice");
    const waiting = waitFor(app, token, { maxWaitSec: 900 });
    await new Promise((r) => setTimeout(r, 60));
    await ask("alice", "now?").expect(201);
    expect(jsonOf<{ event: { text: string } }>(await waiting).event.text).toBe("now?");
    expect(store.coachWatchers()).toBe(0);
  });

  it("returns a due clock check-in while it waits", async () => {
    const { app, saveCode, mintFor, cadence, clock } = coachSetup();
    await saveCode("alice", "a");
    await cadence("alice", "minutes10").expect(204);
    await saveCode("alice", "b");
    const token = await mintFor("alice");
    const waiting = waitFor(app, token, { maxWaitSec: 900 });
    await new Promise((r) => setTimeout(r, 60));
    clock.advance(10 * MIN);
    expect(jsonOf<{ event: { kind: string; reason: string } }>(await waiting).event).toMatchObject({
      kind: "checkin",
      reason: "minutes",
    });
  });

  it("returns {event: null} on timeout, takes nothing and closes its listener", async () => {
    const { app, saveCode, mintFor, store, clock, thread } = coachSetup();
    await saveCode("alice", "a");
    await saveCode("bob", "b");
    await request(app)
      .post("/api/sessions/untitled/coach/asks")
      .set({ Authorization: "Bearer id-bob" })
      .send({ text: "bob's ask" })
      .expect(201);
    const token = await mintFor("alice");
    const waiting = waitFor(app, token, { maxWaitSec: 1 });
    await new Promise((r) => setTimeout(r, 60));
    clock.advance(1500);
    expect(jsonOf(await waiting)).toEqual({ event: null });
    expect(store.coachWatchers()).toBe(0);
    // Bob's ask stays for Bob's coach.
    expect((await thread("bob")).events[0]?.status).toBe("pending");
  });

  it("caps maxWaitSec at 900", async () => {
    const { app, mintFor } = coachSetup();
    expect((await waitFor(app, await mintFor("alice"), { maxWaitSec: 901 })).isError).toBe(true);
  });
});

describe("say", () => {
  it("posts a note in the open session's thread, for its owner only", async () => {
    const { saveCode, mintFor, callTool, thread, store } = coachSetup();
    await saveCode("alice", "a");
    await saveCode("bob", "b");
    const versionsBefore = JSON.stringify(store.versions.get("alice"));
    const result = await callTool(await mintFor("alice"), "say", { text: "Lovely. What does the hat want?" });
    expect(result.isError).toBeFalsy();
    expect((await thread("alice")).events).toMatchObject([
      { kind: "note", text: "Lovely. What does the hat want?", status: null },
    ]);
    expect((await thread("bob")).events).toHaveLength(0);
    expect(JSON.stringify(store.versions.get("alice"))).toBe(versionsBefore);
  });

  it("rejects an empty note and one over 600 characters", async () => {
    const { saveCode, mintFor, callTool, thread } = coachSetup();
    await saveCode("alice", "a");
    const token = await mintFor("alice");
    const long = await callTool(token, "say", { text: "x".repeat(601) });
    expect(long.isError).toBe(true);
    expect(textOf(long)).toMatch(/601 characters/);
    expect((await callTool(token, "say", { text: "  " })).isError).toBe(true);
    expect((await callTool(token, "say", { text: "Use `slow` here? " + "x".repeat(500) })).isError).toBeFalsy();
    expect((await thread("alice")).events).toHaveLength(1);
  });

  it("keeps each thread to its owner on the page API", async () => {
    const { app, asUser, ask, cadence } = coachSetup();
    const bobs = await request(app).post("/api/sessions").set(asUser("bob")).send({ name: "Bob's" }).expect(201);
    const id = (bobs.body as { id: string }).id;
    await request(app).get(`/api/sessions/${id}/coach`).set(asUser("alice")).expect(404);
    await ask("alice", "hi", id).expect(404);
    await cadence("alice", "runs15", id).expect(404);
    await request(app).get(`/api/sessions/${id}/coach`).set(asUser("bob")).expect(200);
  });
});

describe("lookup_sound synth aliases", () => {
  it("knows the short waveform names the browser plays", async () => {
    const { mintFor, callTool } = coachSetup();
    const token = await mintFor("alice");
    for (const [alias, of] of [
      ["sqr", "square"],
      ["tri", "triangle"],
      ["sin", "sine"],
      ["saw", "sawtooth"],
    ] as const) {
      const found = jsonOf<{ results: { name: string; aliasOf?: string }[] }>(
        await callTool(token, "lookup_sound", { query: alias }),
      );
      expect(found.results[0]).toMatchObject({ name: alias, aliasOf: of });
    }
  });
});
