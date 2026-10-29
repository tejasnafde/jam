// Firestore layout (named database `jam-db`; "jam" is below the 4-character minimum):
//   users/{uid}                 { email, updatedAt }
//   users/{uid}/versions/{id}   CodeVersion
//   users/{uid}/audio/{id}      AudioSnapshot
//   users/{uid}/plans/{id}      SessionPlan (newest is current)
//   tokens/{sha256(token)}      TokenRecord
//   oauthClients/{sha256(id)}   OAuthClientRecord (the client id can be a URL, which is not a valid doc id)
//   oauthRequests/{id}          AuthRequestRecord, deleted when the user decides
//   oauthCodes/{sha256(code)}   AuthCodeRecord
//   oauthGrants/{id}            GrantRecord
//   oauthTokens/{sha256(token)} OAuthTokenRecord
// Requests, codes and OAuth tokens carry `expireAt` (a Timestamp) for a Firestore TTL policy.
// Every query is a single-field equality, so no composite index is needed.

import type { AudioSnapshot, CodeVersion, PlanInput, SessionPlan } from "@jam/shared";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import type {
  AuthCodeRecord,
  AuthRequestRecord,
  GrantRecord,
  NewAudioSnapshot,
  OAuthClientRecord,
  OAuthTokenRecord,
  PlanPatch,
  Store,
  TokenRecord,
} from "./types.js";

const now = () => new Date().toISOString();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** How long a rotated refresh token is kept to detect a replay. */
const ROTATED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** Reads a record that was written with an extra `expireAt` field, without that field. */
function record<T>(doc: DocumentSnapshot): T | null {
  if (!doc.exists) return null;
  const data = { ...doc.data() };
  delete data.expireAt;
  return data as T;
}

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

  private oauth(name: "oauthClients" | "oauthRequests" | "oauthCodes" | "oauthGrants" | "oauthTokens") {
    return this.db.collection(name);
  }

  async saveOAuthClient(client: OAuthClientRecord) {
    await this.oauth("oauthClients").doc(sha256(client.clientId)).set(client);
  }

  async getOAuthClient(clientId: string) {
    return record<OAuthClientRecord>(await this.oauth("oauthClients").doc(sha256(clientId)).get());
  }

  async saveAuthRequest(request: AuthRequestRecord) {
    await this.oauth("oauthRequests")
      .doc(request.id)
      .create({ ...request, expireAt: new Date(request.expiresAt) });
  }

  async getAuthRequest(id: string) {
    return record<AuthRequestRecord>(await this.oauth("oauthRequests").doc(id).get());
  }

  async takeAuthRequest(id: string) {
    const ref = this.oauth("oauthRequests").doc(id);
    return this.db.runTransaction(async (tx) => {
      const found = record<AuthRequestRecord>(await tx.get(ref));
      if (found) tx.delete(ref);
      return found;
    });
  }

  async saveAuthCode(code: AuthCodeRecord) {
    await this.oauth("oauthCodes")
      .doc(code.hash)
      .create({ ...code, expireAt: new Date(code.expiresAt) });
  }

  async getAuthCode(hash: string) {
    return record<AuthCodeRecord>(await this.oauth("oauthCodes").doc(hash).get());
  }

  async useAuthCode(hash: string, at: number) {
    const ref = this.oauth("oauthCodes").doc(hash);
    return this.db.runTransaction(async (tx) => {
      const found = record<AuthCodeRecord>(await tx.get(ref));
      if (found && found.usedAt === null) tx.update(ref, { usedAt: at });
      return found;
    });
  }

  async saveGrant(grant: GrantRecord) {
    await this.oauth("oauthGrants").doc(grant.id).set(grant);
  }

  async getGrant(id: string) {
    return record<GrantRecord>(await this.oauth("oauthGrants").doc(id).get());
  }

  async listGrants(uid: string) {
    const snap = await this.oauth("oauthGrants").where("uid", "==", uid).get();
    return snap.docs
      .map((d) => record<GrantRecord>(d))
      .filter((g): g is GrantRecord => g !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async touchGrant(id: string) {
    await this.oauth("oauthGrants").doc(id).update({ lastUsedAt: now() });
  }

  async deleteGrant(id: string) {
    // The grant goes first: a token whose grant is gone no longer refreshes.
    await this.oauth("oauthGrants").doc(id).delete();
    const tokens = this.oauth("oauthTokens").where("grantId", "==", id).limit(400);
    for (;;) {
      const snap = await tokens.get();
      if (snap.empty) return;
      const batch = this.db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
    }
  }

  async saveOAuthToken(token: OAuthTokenRecord) {
    await this.oauth("oauthTokens")
      .doc(token.hash)
      .create({ ...token, expireAt: new Date(token.expiresAt) });
  }

  async getOAuthToken(hash: string) {
    return record<OAuthTokenRecord>(await this.oauth("oauthTokens").doc(hash).get());
  }

  async rotateRefreshToken(hash: string, at: number) {
    const ref = this.oauth("oauthTokens").doc(hash);
    return this.db.runTransaction(async (tx) => {
      const found = record<OAuthTokenRecord>(await tx.get(ref));
      if (found && found.kind === "refresh" && found.rotatedAt === null) {
        const keepUntil = Math.min(found.expiresAt, at + ROTATED_KEEP_MS);
        tx.update(ref, { rotatedAt: at, expireAt: new Date(keepUntil) });
      }
      return found;
    });
  }

  async deleteOAuthToken(hash: string) {
    await this.oauth("oauthTokens").doc(hash).delete();
  }
}
