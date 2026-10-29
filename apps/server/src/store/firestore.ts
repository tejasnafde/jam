// Firestore layout (named database `jam-db`; "jam" is below the 4-character minimum):
//   users/{uid}                 { email, updatedAt }
//   users/{uid}/versions/{id}   CodeVersion
//   users/{uid}/audio/{id}      AudioSnapshot
//   users/{uid}/plans/{id}      SessionPlan (newest is current)
//   tokens/{sha256(token)}      TokenRecord

import type { AudioSnapshot, CodeVersion, PlanInput, SessionPlan } from "@jam/shared";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { NewAudioSnapshot, PlanPatch, Store, TokenRecord } from "./types.js";

const now = () => new Date().toISOString();

function withId<T>(doc: DocumentSnapshot): T {
  return { id: doc.id, ...doc.data() } as T;
}

export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  private user(uid: string) {
    return this.db.collection("users").doc(uid);
  }

  private tokens() {
    return this.db.collection("tokens");
  }

  async saveVersion(uid: string, code: string, email?: string): Promise<CodeVersion> {
    const ts = now();
    const userRef = this.user(uid);
    const versions = userRef.collection("versions");
    return this.db.runTransaction(async (tx) => {
      const latest = await tx.get(versions.orderBy("createdAt", "desc").limit(1));
      tx.set(userRef, { ...(email ? { email } : {}), updatedAt: ts }, { merge: true });
      const top = latest.docs[0];
      if (top && top.get("code") === code) {
        const evalCount = Number(top.get("evalCount") ?? 1) + 1;
        tx.update(top.ref, { evaluatedAt: ts, evalCount });
        return { ...withId<CodeVersion>(top), evaluatedAt: ts, evalCount };
      }
      const ref = versions.doc();
      const version = { code, createdAt: ts, evaluatedAt: ts, evalCount: 1 };
      tx.set(ref, version);
      return { id: ref.id, ...version };
    });
  }

  async latestVersion(uid: string) {
    return (await this.listVersions(uid, 1))[0] ?? null;
  }

  async listVersions(uid: string, limit: number) {
    const snap = await this.user(uid).collection("versions").orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((d) => withId<CodeVersion>(d));
  }

  async saveAudio(uid: string, snapshot: NewAudioSnapshot): Promise<AudioSnapshot> {
    const ref = this.user(uid).collection("audio").doc();
    const doc = { ...snapshot, createdAt: now() };
    await ref.set(doc);
    return { id: ref.id, ...doc };
  }

  async listAudio(uid: string, limit: number) {
    const snap = await this.user(uid).collection("audio").orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((d) => withId<AudioSnapshot>(d));
  }

  async savePlan(uid: string, plan: PlanInput): Promise<SessionPlan> {
    const ref = this.user(uid).collection("plans").doc();
    const ts = now();
    const doc = { ...plan, currentStage: 0, createdAt: ts, updatedAt: ts };
    await ref.set(doc);
    return { id: ref.id, ...doc };
  }

  async currentPlan(uid: string) {
    const snap = await this.user(uid).collection("plans").orderBy("createdAt", "desc").limit(1).get();
    const doc = snap.docs[0];
    return doc ? withId<SessionPlan>(doc) : null;
  }

  async updatePlan(uid: string, planId: string, patch: PlanPatch) {
    const ref = this.user(uid).collection("plans").doc(planId);
    await ref.update({ ...patch, updatedAt: now() });
    return withId<SessionPlan>(await ref.get());
  }

  async createToken(hash: string, uid: string, label: string): Promise<TokenRecord> {
    const doc = { uid, label, createdAt: now(), lastUsedAt: null };
    await this.tokens().doc(hash).create(doc);
    return { id: hash, ...doc };
  }

  async findToken(hash: string) {
    const doc = await this.tokens().doc(hash).get();
    return doc.exists ? withId<TokenRecord>(doc) : null;
  }

  async touchToken(hash: string) {
    await this.tokens().doc(hash).update({ lastUsedAt: now() });
  }

  async listTokens(uid: string) {
    const snap = await this.tokens().where("uid", "==", uid).get();
    return snap.docs.map((d) => withId<TokenRecord>(d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteToken(uid: string, hash: string) {
    const ref = this.tokens().doc(hash);
    const doc = await ref.get();
    if (!doc.exists || doc.get("uid") !== uid) return false;
    await ref.delete();
    return true;
  }
}
