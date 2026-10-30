import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";

// The fake must behave like the Firestore store, since every other test relies on it.
describe("MemoryStore", () => {
  it("orders versions newest first and dedupes identical code", async () => {
    const store = new MemoryStore();
    await store.saveVersion("u", "a");
    await store.saveVersion("u", "b");
    const bumped = await store.saveVersion("u", "b");
    expect(bumped?.evalCount).toBe(2);
    expect((await store.listVersions("u", 10)).map((v) => v.code)).toEqual(["b", "a"]);
    expect((await store.latestVersion("u"))?.code).toBe("b");
    expect(await store.latestVersion("nobody")).toBeNull();
  });

  it("keeps old plans and treats the newest as current", async () => {
    const store = new MemoryStore();
    const stages = [1, 2, 3, 4].map((n) => ({ title: `t${n}`, goal: `g${n}` }));
    await store.savePlan("u", { destination: "first", stages });
    const second = await store.savePlan("u", { destination: "second", stages });
    expect((await store.currentPlan("u"))?.destination).toBe("second");
    const updated = await store.updatePlan("u", second.id, { currentStage: 3 });
    expect(updated.currentStage).toBe(3);
    expect(store.plans.get("u")).toHaveLength(2);
  });

  it("scopes tokens to their owner", async () => {
    const store = new MemoryStore();
    await store.createToken("h1", "alice", "a");
    await expect(store.createToken("h1", "bob", "b")).rejects.toThrow();
    expect(await store.deleteToken("bob", "h1")).toBe(false);
    expect(await store.listTokens("bob")).toEqual([]);
    await store.touchToken("h1");
    expect((await store.findToken("h1"))?.lastUsedAt).not.toBeNull();
    expect(await store.deleteToken("alice", "h1")).toBe(true);
  });
});
