import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app.js";
import { SoundIndex } from "../src/sounds/soundIndex.js";
import { MemoryBlobs } from "../src/store/blobs.js";
import type { PrepRun } from "../src/prep/runner.js";
import { MemoryStore } from "../src/store/memory.js";
import { MemoryPrepStore } from "../src/store/prep.js";
import { MemorySampleStore } from "../src/store/samples.js";

/** Fake Firebase: "id-<uid>" is a valid ID token for <uid>. */
export const verifyIdToken = async (token: string) => {
  if (!token.startsWith("id-")) throw new Error("bad token");
  return { uid: token.slice(3), email: `${token.slice(3)}@example.com` };
};

const fakeMaps: Record<string, unknown> = {
  "tidal-drum-machines.json": { _base: "x", RolandTR808_bd: ["a.wav", "b.wav"], RolandTR808_sd: ["c.wav"] },
  "piano.json": { _base: "x", piano: { A0: "a.mp3" } },
  "Dirt-Samples.json": { _base: "x", bd: ["1.wav", "2.wav", "3.wav"], casio: ["c.wav"] },
  "tidal-drum-machines-alias.json": { RolandTR808: "TR808" },
};

export const fakeFetcher = async (url: string) => {
  const key = url.split("/").pop() ?? "";
  if (!(key in fakeMaps)) throw new Error("404");
  return fakeMaps[key];
};

export function setup() {
  const store = new MemoryStore();
  const samples = new MemorySampleStore();
  const blobs = new MemoryBlobs();
  const prep = new MemoryPrepStore();
  /** Every prep run the app started. Set runner.fail to make the runner throw. */
  const runs: PrepRun[] = [];
  const runner = { fail: false };
  const run = async (r: PrepRun) => {
    if (runner.fail) throw new Error("Cloud Run said no");
    runs.push(r);
  };
  const app = createApp({
    store,
    samples,
    blobs,
    sounds: new SoundIndex(fakeFetcher),
    verifyIdToken,
    prep: { store: prep, run },
  });
  return { store, samples, blobs, prep, runs, runner, app, ...clients(app) };
}

const ACCEPT = "application/json, text/event-stream";

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function clients(app: ReturnType<typeof createApp>) {
  let rpcId = 0;

  const asUser = (uid: string) => ({ Authorization: `Bearer id-${uid}` });

  const mcp = (token: string | null, method: string, params: unknown = {}) => {
    const req = request(app).post("/mcp").set("Accept", ACCEPT).set("Content-Type", "application/json");
    if (token) req.set("Authorization", `Bearer ${token}`);
    return req.send({ jsonrpc: "2.0", id: ++rpcId, method, params });
  };

  const callTool = async (token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const res = await mcp(token, "tools/call", { name, arguments: args });
    expect(res.status).toBe(200);
    return res.body.result as ToolResult;
  };

  const mintFor = async (uid: string): Promise<string> => {
    const res = await request(app).post("/api/tokens").set(asUser(uid)).send({ label: "test" });
    expect(res.status).toBe(201);
    return res.body.token as string;
  };

  const saveCode = (uid: string, code: string) =>
    request(app).post("/api/versions").set(asUser(uid)).send({ code }).expect(201);

  return { asUser, mcp, callTool, mintFor, saveCode, ACCEPT };
}

export const textOf = (result: ToolResult) => result.content[0]?.text ?? "";
export const jsonOf = <T = Record<string, unknown>>(result: ToolResult) => JSON.parse(textOf(result)) as T;
