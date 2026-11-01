import express from "express";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { staticRouter } from "../src/routes/static.js";

function app() {
  const dir = mkdtempSync(path.join(tmpdir(), "jam-static-"));
  writeFileSync(path.join(dir, "index.html"), "<p>app</p>");
  writeFileSync(path.join(dir, "render.html"), "<p>render</p>");
  writeFileSync(path.join(dir, "chunk-abc.js"), "1");
  return express().use(staticRouter(dir));
}

describe("staticRouter", () => {
  it("serves render.html and the page with no-cache, so a deploy never leaves a stale frame", async () => {
    const a = app();
    const render = await request(a).get("/render.html").expect(200);
    expect(render.text).toContain("render");
    expect(render.headers["cache-control"]).toBe("no-cache");
    expect((await request(a).get("/").expect(200)).headers["cache-control"]).toBe("no-cache");
  });

  it("keeps the hour on hashed assets", async () => {
    const res = await request(app()).get("/chunk-abc.js").expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });
});
