import request from "supertest";
import { describe, expect, it } from "vitest";
import { jsonOf, setup, textOf } from "./helpers.js";

interface ToolInfo {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, unknown> };
}

describe("read-only guarantee", () => {
  it("exposes no tool that can write code", async () => {
    const { mcp, mintFor } = setup();
    const tools = (await mcp(await mintFor("alice"), "tools/list")).body.result.tools as ToolInfo[];
    for (const tool of tools) {
      expect(tool.name).not.toMatch(/write|edit|code_set|set_code|update_code|eval/);
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("code");
      // set_* write the plan; say and wait_for_change write the coach thread. Every other tool only reads.
      const writes = tool.name.startsWith("set_") || tool.name === "say" || tool.name === "wait_for_change";
      expect(tool.annotations?.readOnlyHint).toBe(!writes);
    }
  });

  it("never changes stored versions", async () => {
    const { store, saveCode, mintFor, callTool } = setup();
    await saveCode("alice", 's("bd")');
    const before = JSON.stringify(store.versions.get("alice"));
    const token = await mintFor("alice");
    for (const name of ["get_current_code", "get_history", "get_audio_snapshot", "get_session_plan"]) {
      await callTool(token, name);
    }
    await callTool(token, "set_session_plan", { destination: "d", stages: stagesOf(4) });
    await callTool(token, "set_stage", { stage: 1 });
    expect(JSON.stringify(store.versions.get("alice"))).toBe(before);
  });
});

describe("get_current_code", () => {
  it("returns the latest code for the token's user only", async () => {
    const { saveCode, mintFor, callTool } = setup();
    await saveCode("alice", 'note("c e g").s("piano")');
    await saveCode("bob", "bob's");
    const result = await callTool(await mintFor("alice"), "get_current_code");
    expect(jsonOf(result).code).toBe('note("c e g").s("piano")');
  });

  it("says when nothing was evaluated", async () => {
    const { mintFor, callTool } = setup();
    expect(textOf(await callTool(await mintFor("carol"), "get_current_code"))).toMatch(/not evaluated/);
  });
});

describe("get_history", () => {
  it("returns diffs newest first, or full code", async () => {
    const { saveCode, mintFor, callTool } = setup();
    for (const code of ['s("bd")', 's("bd sd")', 's("bd sd hh")']) await saveCode("alice", code);
    const token = await mintFor("alice");
    type History = { session: string; versions: { diff?: string; code?: string }[] };
    const history = jsonOf<History>(await callTool(token, "get_history", { limit: 2 }));
    expect(history.session).toBe("Untitled");
    const diffs = history.versions;
    expect(diffs).toHaveLength(2);
    expect(diffs[0]?.diff).toContain('+s("bd sd hh")');
    expect(diffs[1]?.diff).toContain('-s("bd")');
    const full = jsonOf<History>(await callTool(token, "get_history", { limit: 3, include_diffs: false })).versions;
    expect(full[2]?.code).toBe('s("bd")');
  });

  it("rejects an out-of-range limit", async () => {
    const { mintFor, callTool } = setup();
    expect((await callTool(await mintFor("alice"), "get_history", { limit: 500 })).isError).toBe(true);
  });
});

describe("get_audio_snapshot", () => {
  it("returns the newest snapshot", async () => {
    const { app, asUser, mintFor, callTool } = setup();
    await request(app)
      .post("/api/audio")
      .set(asUser("alice"))
      .send({ versionId: "v1", rms: 0.12, low: 0.6, mid: 0.3, high: 0.1, windowMs: 3000 })
      .expect(201);
    const [snap] = jsonOf<unknown[]>(await callTool(await mintFor("alice"), "get_audio_snapshot"));
    expect(snap).toMatchObject({ versionId: "v1", rms: 0.12, low: 0.6 });
  });

  it("says when there is none", async () => {
    const { mintFor, callTool } = setup();
    expect(textOf(await callTool(await mintFor("alice"), "get_audio_snapshot"))).toMatch(/No audio/);
  });
});

describe("lookup_sound", () => {
  it("finds samples, drum machines, soundfonts and synths", async () => {
    const { mintFor, callTool } = setup();
    const token = await mintFor("alice");
    const bd = jsonOf<{ results: { name: string; usage: string }[] }>(
      await callTool(token, "lookup_sound", { query: "bd" }),
    );
    expect(bd.results[0]?.name).toBe("bd");
    expect(bd.results.map((r) => r.usage)).toContain('s("bd").bank("TR808")');
    const gm = jsonOf<{ results: unknown[] }>(await callTool(token, "lookup_sound", { query: "gm_piano" }));
    expect(gm.results[0]).toMatchObject({ name: "gm_piano", kind: "soundfont" });
    const saw = jsonOf<{ results: { kind: string }[] }>(await callTool(token, "lookup_sound", { query: "sawtooth" }));
    expect(saw.results[0]?.kind).toBe("synth");
  });

  it("finds drum parts by a plain word from the shared alias table", async () => {
    const { mintFor, callTool } = setup();
    const kick = jsonOf<{ results: { name: string }[] }>(
      await callTool(await mintFor("alice"), "lookup_sound", { query: "kick" }),
    );
    expect(kick.results.map((r) => r.name).sort()).toEqual(["RolandTR808_bd", "bd"]);
  });

  it("says when nothing matches", async () => {
    const { mintFor, callTool } = setup();
    expect(textOf(await callTool(await mintFor("alice"), "lookup_sound", { query: "zzzqqq" }))).toMatch(/No default/);
  });
});

function stagesOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ title: `Stage ${i + 1}`, goal: `Goal ${i + 1}` }));
}

describe("set_session_plan and get_session_plan", () => {
  it("saves a plan that the page and the coach can read", async () => {
    const { app, asUser, mintFor, callTool } = setup();
    const token = await mintFor("alice");
    expect(textOf(await callTool(token, "get_session_plan"))).toMatch(/No session plan/);
    const stages = stagesOf(4).map((s, i) => (i === 0 ? { ...s, hint: "start with a kick" } : s));
    const result = await callTool(token, "set_session_plan", { destination: "A slow rainy lofi loop", stages });
    expect(result.isError).toBeFalsy();
    const page = await request(app).get("/api/plan").set(asUser("alice")).expect(200);
    expect(page.body).toMatchObject({ destination: "A slow rainy lofi loop", currentStage: 0 });
    expect(page.body.stages[0].hint).toBe("start with a kick");
    expect(jsonOf(await callTool(token, "get_session_plan")).destination).toBe("A slow rainy lofi loop");
  });

  it("enforces 4 to 6 stages", async () => {
    const { store, mintFor, callTool } = setup();
    const token = await mintFor("alice");
    expect((await callTool(token, "set_session_plan", { destination: "x", stages: stagesOf(3) })).isError).toBe(true);
    expect((await callTool(token, "set_session_plan", { destination: "x", stages: stagesOf(7) })).isError).toBe(true);
    expect(store.plans.get("alice")).toBeUndefined();
  });
});

describe("set_stage", () => {
  it("needs a plan and a valid index", async () => {
    const { mintFor, callTool } = setup();
    const token = await mintFor("alice");
    expect((await callTool(token, "set_stage", { stage: 1 })).isError).toBe(true);
    await callTool(token, "set_session_plan", { destination: "d", stages: stagesOf(4) });
    expect((await callTool(token, "set_stage", { stage: 4 })).isError).toBe(true);
    const moved = jsonOf(await callTool(token, "set_stage", { stage: 2, note: "happy accident" }));
    expect(moved).toMatchObject({ currentStage: 2, note: "happy accident" });
  });
});

describe("start_session prompt", () => {
  it("carries the Bob Ross rules and the mood", async () => {
    const { mcp, mintFor } = setup();
    const res = await mcp(await mintFor("alice"), "prompts/get", {
      name: "start_session",
      arguments: { mood: "dark techno" },
    });
    expect(res.status).toBe(200);
    const text = res.body.result.messages[0].content.text as string;
    expect(text).toMatch(/what we are about to paint today/);
    expect(text).toMatch(/happy accidents/);
    expect(text).toContain("dark techno");
  });
});
