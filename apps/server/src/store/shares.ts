// shares/{shareId}   ShareRecord (top level, so the public page reads one doc by id)

import type { Share } from "@jam/shared";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/** The stored share. uid, storagePath and the code (unless shown) never leave the server. */
export interface ShareRecord extends Share {
  uid: string;
  storagePath: string;
  /** Stored only when showCode is on. */
  code: string | null;
  /** False until the audio is uploaded and checked. A share that never gets ready is never listed. */
  ready: boolean;
}

export type SharePatch = Partial<Pick<ShareRecord, "enabled" | "title" | "ready">>;

export interface ShareStore {
  create(share: ShareRecord): Promise<void>;
  get(id: string): Promise<ShareRecord | null>;
  /** Every share of the user, ready or not, newest first. */
  listByOwner(uid: string): Promise<ShareRecord[]>;
  update(id: string, patch: SharePatch): Promise<void>;
  addPlay(id: string): Promise<void>;
}

/** What the owner sees: the record without uid, storage path, code and ready. */
export function ownerView({ uid: _uid, storagePath: _path, code: _code, ready: _ready, ...share }: ShareRecord): Share {
  return share;
}

const byNewest = (a: ShareRecord, b: ShareRecord) => b.createdAt.localeCompare(a.createdAt);

/** An in-memory ShareStore for tests and local runs. */
export class MemoryShareStore implements ShareStore {
  readonly shares = new Map<string, ShareRecord>();

  async create(share: ShareRecord) {
    if (this.shares.has(share.id)) throw new Error(`ALREADY_EXISTS: ${share.id}`);
    this.shares.set(share.id, structuredClone(share));
  }

  async get(id: string) {
    const share = this.shares.get(id);
    return share ? structuredClone(share) : null;
  }

  async listByOwner(uid: string) {
    return [...this.shares.values()]
      .filter((s) => s.uid === uid)
      .sort(byNewest)
      .map((s) => structuredClone(s));
  }

  async update(id: string, patch: SharePatch) {
    const share = this.shares.get(id);
    if (share) this.shares.set(id, { ...share, ...patch });
  }

  async addPlay(id: string) {
    const share = this.shares.get(id);
    if (share) share.plays += 1;
  }
}

/**
 * Firestore shares. listByOwner filters on uid only and sorts in memory, so it needs no
 * composite index; a user has at most a few hundred shares.
 */
export class FirestoreShareStore implements ShareStore {
  constructor(private readonly db: Firestore) {}

  private col() {
    return this.db.collection("shares");
  }

  async create(share: ShareRecord) {
    await this.col().doc(share.id).create(share);
  }

  async get(id: string) {
    const doc = await this.col().doc(id).get();
    return doc.exists ? ({ ...doc.data(), id: doc.id } as ShareRecord) : null;
  }

  async listByOwner(uid: string) {
    const snap = await this.col().where("uid", "==", uid).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ShareRecord).sort(byNewest);
  }

  async update(id: string, patch: SharePatch) {
    await this.col().doc(id).update(patch);
  }

  async addPlay(id: string) {
    await this.col()
      .doc(id)
      .update({ plays: FieldValue.increment(1) });
  }
}
