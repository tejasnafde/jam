import request from "supertest";
import { describe, expect, it } from "vitest";
import { hashToken, mintToken, TOKEN_PREFIX } from "../src/auth/tokens.js";
import { TOOL_NAMES } from "../src/mcp/server.js";
import { setup } from "./helpers.js";

describe("token helpers", () => {
  it("mints distinct prefixed tokens with stable hashes", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});

describe("page auth (Firebase ID token)", () => {
  it("rejects a missing or invalid ID token", async () => {
    const { app } = setup();
    await request(app).post("/api/versions").send({ code: "x" }).expect(401);
    await request(app).post("/api/versions").set("Authorization", "Bearer nope").send({ code: "x" }).expect(401);
    await request(app).get("/api/plan").expect(401);
  });
});

describe("MCP auth (personal token)", () => {
  it("rejects a missing, unknown or wrong-kind bearer", async () => {
    const { mcp } = setup();
    expect((await mcp(null, "tools/list")).status).toBe(401);
    expect((await mcp("jam_notarealtoken", "tools/list")).status).toBe(401);
    expect((await mcp("id-alice", "tools/list")).status).toBe(401);
  });

  it("never reads a token from the query string", async () => {
    const { app, mintFor, ACCEPT } = setup();
    const token = await mintFor("alice");
    const res = await request(app)
      .post(`/mcp?token=${token}`)
      .set("Accept", ACCEPT)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });

  it("accepts a valid bearer and lists exactly the expected tools", async () => {
    const { mcp, mintFor } = setup();
    const res = await mcp(await mintFor("alice"), "tools/list");
    expect(res.status).toBe(200);
    const names = (res.body.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it("answers initialize with the coaching instructions", async () => {
    const { mcp, mintFor } = setup();
    const res = await mcp(await mintFor("alice"), "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.instructions).toMatch(/Never write the user's pattern/);
  });

  it("returns 405 for GET in stateless mode", async () => {
    const { app, mintFor } = setup();
    const token = await mintFor("alice");
    await request(app).get("/mcp").set("Authorization", `Bearer ${token}`).expect(405);
  });
});
