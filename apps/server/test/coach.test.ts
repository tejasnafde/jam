import {
  advanceCadence,
  COACH_EVERY_MS,
  pickCoachEvent,
  type CoachEvent,
  DEFAULT_CADENCE_STATE,
  type CoachCadenceState,
  type CoachStatus,
  type CoachThread,
} from "@jam/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../src/mcp/context.js";
import { registerWaitForChange } from "../src/mcp/tools/waitForChange.js";
import { MemoryStore } from "../src/store/memory.js";
import { jsonOf, setup, testClock, textOf } from "./helpers.js";

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
  /** The page's cheap poll. It also records that the page is open. */
  const status = async (uid: string, sessionId = "untitled") =>
    (await request(ctx.app).get(`/api/sessions/${sessionId}/coach/status`).set(ctx.asUser(uid)).expect(200))
      .body as CoachStatus;
  return { ...ctx, thread, ask, cadence, status };
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
    const { app, asUser, saveCode, mintFor, callTool, ask, thread, status } = coachSetup();
    const saved = await saveCode("alice", 's("bd sd")');
    await status("alice");
    await request(app)
      .post("/api/sessions/untitled/error")
      .set(asUser("alice"))
      .send({ code: 's("bd sd").oops()', message: "oops is not a function" })
      .expect(204);
    await request(app)
      .post("/api/audio")
      .set(asUser("alice"))
      .send({ versionId: (saved.body as { id: string }).id, rms: 0.2, low: 0.5, mid: 0.3, high: 0.2, windowMs: 3000 })
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
    const { app, saveCode, mintFor, ask, status } = coachSetup();
    await saveCode("alice", "a");
    await status("alice");
    await ask("alice", "").expect(201);
    await ask("alice", "second").expect(201);
    const token = await mintFor("alice");
    const first = jsonOf<{ event: { text: string; meaning: string } }>(await waitFor(app, token));
    expect(first.event.meaning).toMatch(/Check my music/);
    expect(jsonOf<{ event: { text: string } }>(await waitFor(app, token)).event.text).toBe("second");
  });

  it("wakes up when an ask arrives during the wait", async () => {
    const { app, saveCode, mintFor, ask, store, status } = coachSetup();
    await saveCode("alice", "a");
    await status("alice");
    const token = await mintFor("alice");
    const waiting = waitFor(app, token, { maxWaitSec: 900 });
    await new Promise((r) => setTimeout(r, 60));
    await ask("alice", "now?").expect(201);
    expect(jsonOf<{ event: { text: string } }>(await waiting).event.text).toBe("now?");
    expect(store.coachWatchers()).toBe(0);
  });

  it("returns a due clock check-in while it waits", async () => {
    const { app, saveCode, mintFor, cadence, clock, status } = coachSetup();
    await saveCode("alice", "a");
    await status("alice");
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
    const { app, saveCode, mintFor, store, clock, thread, status } = coachSetup();
    await saveCode("alice", "a");
    await saveCode("bob", "b");
    await status("alice");
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

describe("pickCoachEvent", () => {
  const ev = (
    id: string,
    kind: CoachEvent["kind"],
    minutesAgo: number,
    extra: Partial<CoachEvent> = {},
  ): CoachEvent => ({
    id,
    sessionId: "s",
    kind,
    text: "",
    createdAt: new Date(T0 - minutesAgo * MIN).toISOString(),
    status: "pending",
    ...extra,
  });

  it("takes asks before check-ins, older first", () => {
    const picked = pickCoachEvent([ev("c", "checkin", 5), ev("a2", "ask", 1), ev("a1", "ask", 2)], T0);
    expect(picked.take?.id).toBe("a1");
    expect(picked.open).toBe(true);
  });

  it("drops a pending check-in older than 10 minutes", () => {
    const picked = pickCoachEvent([ev("old", "checkin", 11), ev("new", "checkin", 9)], T0);
    expect(picked.drop).toEqual(["old"]);
    expect(picked.take?.id).toBe("new");
    expect(pickCoachEvent([ev("old", "checkin", 40)], T0)).toEqual({
      take: null,
      drop: ["old"],
      giveUp: [],
      open: false,
    });
  });

  it("gives a taken event back after 60 s, and gives up after 3 takes", () => {
    const taken = (takes: number, secondsAgo: number) =>
      ev("a", "ask", 5, { status: "taken", takes, takenAt: new Date(T0 - secondsAgo * 1000).toISOString() });
    expect(pickCoachEvent([taken(1, 30)], T0)).toMatchObject({ take: null, open: true });
    expect(pickCoachEvent([taken(1, 61)], T0).take?.id).toBe("a");
    expect(pickCoachEvent([taken(3, 61)], T0)).toEqual({ take: null, drop: [], giveUp: ["a"], open: false });
  });
});

/** wait_for_change's handler on a MemoryStore, without HTTP, so a test can abort it. */
function directWait() {
  const store = new MemoryStore();
  const clock = testClock();
  type Handler = (
    args: { maxWaitSec: number },
    extra: { signal: AbortSignal },
  ) => Promise<{ content: { type: string; text: string }[] }>;
  let handler: Handler | undefined;
  const server = { registerTool: (_name: string, _config: unknown, cb: Handler) => void (handler = cb) };
  const ctx = { uid: "alice", store, coach: { now: clock.now, pollMs: 5 } } as unknown as ToolContext;
  registerWaitForChange(server as unknown as McpServer, ctx);
  const call = (signal = new AbortController().signal) => {
    if (!handler) throw new Error("not registered");
    return handler({ maxWaitSec: 50 }, { signal });
  };
  const events = async () => (await store.coachThread("alice", "untitled", 50, clock.now()))?.events ?? [];
  return { store, clock, call, events };
}

describe("wait_for_change never loses an event", () => {
  it("takes nothing when the client already went away", async () => {
    const { store, clock, call, events } = directWait();
    await store.saveVersion("alice", "a");
    await store.coachStatus("alice", "untitled", clock.now());
    await store.addCoachEvent("alice", "untitled", { kind: "ask", text: "hi" }, clock.now());
    const gone = new AbortController();
    gone.abort();
    expect(jsonOf(await call(gone.signal))).toEqual({ event: null });
    expect((await events())[0]?.status).toBe("pending");
  });

  it("puts the event back when building the result fails", async () => {
    const { store, clock, call, events } = directWait();
    await store.saveVersion("alice", "a");
    await store.addCoachEvent("alice", "untitled", { kind: "ask", text: "hi" }, clock.now());
    vi.spyOn(store, "latestVersion").mockRejectedValueOnce(new Error("Firestore said no"));
    await expect(call()).rejects.toThrow("Firestore said no");
    expect((await events())[0]).toMatchObject({ status: "pending", takenAt: null, takes: 0 });
    expect(jsonOf<{ event: { text: string } }>(await call()).event.text).toBe("hi");
  });

  it("gives a taken event to the coach again after 60 s with no note, and not after a note", async () => {
    const { store, clock, call, events } = directWait();
    await store.saveVersion("alice", "a");
    await store.coachStatus("alice", "untitled", clock.now());
    await store.addCoachEvent("alice", "untitled", { kind: "ask", text: "lost" }, clock.now());
    await call();
    clock.advance(30_000);
    expect(await store.takeCoachEvent("alice", "untitled", clock.now())).toBeNull();
    clock.advance(31_000);
    expect(jsonOf<{ event: { text: string } }>(await call()).event.text).toBe("lost");
    await store.addCoachEvent("alice", "untitled", { kind: "note", text: "Lovely." }, clock.now());
    clock.advance(120_000);
    expect(await store.takeCoachEvent("alice", "untitled", clock.now())).toBeNull();
    expect((await events())[0]).toMatchObject({ status: "done", takes: 2 });
    expect(await store.openCoachSessions("alice")).toEqual([]);
  });

  it("returns userAway at once when the page has not been seen for 3 minutes", async () => {
    const { store, clock, call } = directWait();
    await store.saveVersion("alice", "a");
    expect(jsonOf(await call())).toEqual({ event: null, userAway: true });
    await store.coachStatus("alice", "untitled", clock.now());
    clock.advance(3 * MIN);
    expect(jsonOf(await call())).toEqual({ event: null, userAway: true });
  });
});

describe("coach bookkeeping for the page", () => {
  it("records pageSeenAt from the page's poll at most once a minute", async () => {
    const { saveCode, status, thread, store, clock } = coachSetup();
    await saveCode("alice", "a");
    await status("alice");
    const first = store.pageSeen.get("alice");
    expect(first).toBe(new Date(T0).toISOString());
    clock.advance(30_000);
    await thread("alice");
    expect(store.pageSeen.get("alice")).toBe(first);
    clock.advance(31_000);
    await status("alice");
    expect(store.pageSeen.get("alice")).toBe(new Date(T0 + 61_000).toISOString());
  });

  it("moves updatedAt on an ask, a take, a note and a check-in, and not on a plain run", async () => {
    const { app, saveCode, status, ask, mintFor, callTool, cadence, clock } = coachSetup();
    await saveCode("alice", "a");
    expect((await status("alice")).updatedAt).toBeNull();
    await ask("alice", "hi").expect(201);
    const asked = (await status("alice")).updatedAt;
    expect(asked).toBe(new Date(T0).toISOString());
    clock.advance(1000);
    const token = await mintFor("alice");
    await waitFor(app, token);
    const taken = (await status("alice")).updatedAt;
    expect(taken).not.toBe(asked);
    clock.advance(1000);
    await callTool(token, "say", { text: "What do you hear?" });
    const noted = (await status("alice")).updatedAt;
    expect(noted).not.toBe(taken);
    clock.advance(1000);
    await saveCode("alice", "b");
    expect((await status("alice")).updatedAt).toBe(noted);
    await cadence("alice", "runs15").expect(204);
    for (let i = 0; i < 15; i++) await saveCode("alice", `s("x${i}")`);
    expect((await status("alice")).updatedAt).not.toBe(noted);
  });
});

describe("wait_for_change order and scope", () => {
  it("answers a typed question before an older automatic check-in", async () => {
    const { app, saveCode, mintFor, ask, cadence, status } = coachSetup();
    await saveCode("alice", "a");
    await status("alice");
    await cadence("alice", "runs15").expect(204);
    for (let i = 0; i < 15; i++) await saveCode("alice", `s("x${i}")`);
    await ask("alice", "why is the bass muddy?").expect(201);
    const token = await mintFor("alice");
    expect(jsonOf<{ event: { kind: string } }>(await waitFor(app, token)).event.kind).toBe("ask");
    expect(jsonOf<{ event: { kind: string } }>(await waitFor(app, token)).event.kind).toBe("checkin");
  });

  it("drops a check-in that waited more than 10 minutes", async () => {
    const { saveCode, cadence, thread, clock, store } = coachSetup();
    await saveCode("alice", "a");
    await cadence("alice", "runs15").expect(204);
    for (let i = 0; i < 15; i++) await saveCode("alice", `s("x${i}")`);
    expect((await thread("alice")).events).toHaveLength(1);
    clock.advance(11 * MIN);
    expect(await store.takeCoachEvent("alice", "untitled", clock.now())).toBeNull();
    expect((await thread("alice")).events).toEqual([]);
    expect(await store.openCoachSessions("alice")).toEqual([]);
  });

  it("gives no audio snapshot that belongs to other code", async () => {
    const { app, asUser, saveCode, mintFor, ask, status } = coachSetup();
    const saved = await saveCode("alice", "a");
    await request(app)
      .post("/api/audio")
      .set(asUser("alice"))
      .send({ versionId: (saved.body as { id: string }).id, rms: 0.2, low: 0.5, mid: 0.3, high: 0.2, windowMs: 3000 })
      .expect(201);
    const other = await request(app).post("/api/sessions").set(asUser("alice")).send({ name: "Rain" }).expect(201);
    const id = (other.body as { id: string }).id;
    await request(app).post("/api/versions").set(asUser("alice")).send({ code: "b", sessionId: id }).expect(201);
    await status("alice", id);
    await ask("alice", "and now?", id).expect(201);
    const got = jsonOf<{ audio: unknown; code: { code: string } }>(await waitFor(app, await mintFor("alice")));
    expect(got.code.code).toBe("b");
    expect(got.audio).toBeNull();
  });

  it("delivers an ask left in another session, and say answers it there", async () => {
    const { app, asUser, saveCode, mintFor, callTool, ask, status, thread, store } = coachSetup();
    await saveCode("alice", 's("bd")');
    await ask("alice", "is the kick ok?").expect(201);
    const other = await request(app).post("/api/sessions").set(asUser("alice")).send({ name: "Rain" }).expect(201);
    const rain = (other.body as { id: string }).id;
    await status("alice", rain);
    const token = await mintFor("alice");
    const got = jsonOf<{
      event: { text: string };
      session: string;
      otherSession?: string;
      code: { code: string };
      next: string;
    }>(await waitFor(app, token));
    expect(got).toMatchObject({ event: { text: "is the kick ok?" }, session: "Untitled", code: { code: 's("bd")' } });
    expect(got.otherSession).toBeDefined();
    expect(got.next).toMatch(/session: "Untitled"/);
    expect((await callTool(token, "say", { text: "It thumps. Hear it?", session: "Untitled" })).isError).toBeFalsy();
    expect((await thread("alice")).events).toMatchObject([
      { kind: "ask", status: "done" },
      { kind: "note", text: "It thumps. Hear it?" },
    ]);
    expect((await thread("alice", rain)).events).toEqual([]);
    expect(await store.openCoachSessions("alice")).toEqual([]);
  });
});
