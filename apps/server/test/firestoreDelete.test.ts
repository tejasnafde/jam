import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirestoreStore } from "../src/store/firestore.js";

/** Just enough of Firestore for deleteSession: one version and one plan, and a log of what was deleted. */
function fakeDb(failBatch: boolean) {
  const deleted: string[] = [];
  const served = new Set<string>();
  const query = (path: string) => {
    const self = {
      where: () => self,
      select: () => self,
      limit: () => self,
      get: async () => {
        const first = !served.has(path);
        served.add(path);
        return { empty: !first, docs: first ? [{ ref: { path: `${path}/child` } }] : [] };
      },
    };
    return self;
  };
  const doc = (path: string): unknown => ({
    path,
    get: async () => ({ exists: true, get: () => undefined }),
    delete: async () => void deleted.push(path),
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string) => ({ doc: (id: string) => doc(`${path}/${id}`), ...query(path) });
  const db = {
    collection,
    batch: () => {
      const refs: string[] = [];
      return {
        delete: (ref: { path: string }) => void refs.push(ref.path),
        commit: async () => {
          if (failBatch) throw new Error("deadline exceeded");
          deleted.push(...refs);
        },
      };
    },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: async () => ({ get: () => undefined }), update: () => {} }),
  };
  return { db: db as unknown as Firestore, deleted };
}

describe("FirestoreStore.deleteSession", () => {
  it("deletes the versions, plans and coach thread first and the session doc last", async () => {
    const { db, deleted } = fakeDb(false);
    expect(await new FirestoreStore(db).deleteSession("alice", "s1")).toBe(true);
    expect(deleted).toEqual([
      "users/alice/versions/child",
      "users/alice/plans/child",
      "users/alice/sessions/s1/coachEvents/child",
      "users/alice/sessions/s1",
    ]);
  });

  it("keeps the session when deleting its versions fails, so the user can delete it again", async () => {
    const { db, deleted } = fakeDb(true);
    await expect(new FirestoreStore(db).deleteSession("alice", "s1")).rejects.toThrow("deadline");
    expect(deleted).not.toContain("users/alice/sessions/s1");
  });
});
