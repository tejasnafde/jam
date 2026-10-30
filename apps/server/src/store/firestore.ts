// Firestore layout (named database `jam-db`; "jam" is below the 4-character minimum):
//   users/{uid}                 { email, updatedAt, currentSessionId }
//   users/{uid}/sessions/{id}   Session (a named piece; "untitled" claims versions from before sessions)
//   users/{uid}/versions/{id}   CodeVersion, with sessionId
//   users/{uid}/audio/{id}      AudioSnapshot
//   users/{uid}/plans/{id}      SessionPlan, with sessionId (a session's planId points at its current plan)
//   tokens/{sha256(token)}      TokenRecord
//   oauthClients/{sha256(id)}   OAuthClientRecord (the client id can be a URL, which is not a valid doc id)
//   oauthRequests/{id}          AuthRequestRecord, deleted when the user decides
//   oauthCodes/{sha256(code)}   AuthCodeRecord
//   oauthGrants/{id}            GrantRecord
//   oauthTokens/{sha256(token)} OAuthTokenRecord
// Requests, codes and OAuth tokens carry `expireAt` (a Timestamp) for a Firestore TTL policy.
// A registered client carries it too, until a grant claims it (24 h after registration).
// One composite index: versions by (sessionId, createdAt desc), in firestore.indexes.json.
// Every other query is a single-field equality or order.

import {
  UNTITLED_SESSION_ID,
  UNTITLED_SESSION_NAME,
  type AudioSnapshot,
  type CodeVersion,
  type PlanInput,
  type Session,
  type SessionError,
  type SessionPlan,
  type SessionSummary,
} from "@jam/shared";
import { FieldValue, type DocumentSnapshot, type Firestore, type Query } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import type {
  AuthCodeRecord,
  AuthRequestRecord,
  GrantRecord,
  NewAudioSnapshot,
  OAuthClientRecord,
  OAuthTokenRecord,
  PlanPatch,
  SessionPatch,
  Store,
  TokenRecord,
} from "./types.js";
import { UNCLAIMED_CLIENT_TTL_MS } from "./types.js";

const now = () => new Date().toISOString();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Writes per batch when a session claims or deletes many documents. Firestore allows 500. */
const BATCH = 400;

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

function toSession(doc: DocumentSnapshot): Session {
  const s = withId<Session>(doc);
  return { ...s, versionCount: Number(s.versionCount ?? 0), planId: s.planId ?? null, lastCode: s.lastCode ?? "" };
}

export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  private user(uid: string) {
    return this.db.collection("users").doc(uid);
  }

  private tokens() {
    return this.db.collection("tokens");
  }

  private sessions(uid: string) {
    return this.user(uid).collection("sessions");
  }

  private async sessionIdOr(uid: string, sessionId?: string) {
    return sessionId ?? (await this.currentSession(uid)).id;
  }

  async saveVersion(uid: string, code: string, opts: { email?: string; sessionId?: string } = {}) {
    const ts = now();
    const userRef = this.user(uid);
    const sessionId = await this.sessionIdOr(uid, opts.sessionId);
    const sessionRef = this.sessions(uid).doc(sessionId);
    const versions = userRef.collection("versions");
    return this.db.runTransaction(async (tx): Promise<CodeVersion | null> => {
      const session = await tx.get(sessionRef);
      if (!session.exists) return null;
      const latest = await tx.get(versions.where("sessionId", "==", sessionId).orderBy("createdAt", "desc").limit(1));
      const email = opts.email;
      tx.set(userRef, { ...(email ? { email } : {}), updatedAt: ts, currentSessionId: sessionId }, { merge: true });
      const top = latest.docs[0];
      if (top && top.get("code") === code) {
        const evalCount = Number(top.get("evalCount") ?? 1) + 1;
        tx.update(top.ref, { evaluatedAt: ts, evalCount });
        tx.update(sessionRef, { lastCode: code, updatedAt: ts, lastError: null });
        return { ...withId<CodeVersion>(top), evaluatedAt: ts, evalCount };
      }
      const ref = versions.doc();
      const version = { code, createdAt: ts, evaluatedAt: ts, evalCount: 1, sessionId };
      tx.set(ref, version);
      tx.update(sessionRef, {
        lastCode: code,
        updatedAt: ts,
        lastError: null,
        versionCount: FieldValue.increment(1),
      });
      return { id: ref.id, ...version };
    });
  }

  async latestVersion(uid: string, sessionId?: string) {
    return (await this.listVersions(uid, 1, { sessionId }))[0] ?? null;
  }

  async listVersions(uid: string, limit: number, opts: { sessionId?: string; before?: string } = {}) {
    const sessionId = await this.sessionIdOr(uid, opts.sessionId);
    let query = this.user(uid).collection("versions").where("sessionId", "==", sessionId).orderBy("createdAt", "desc");
    if (opts.before !== undefined) query = query.startAfter(opts.before);
    const snap = await query.limit(limit).get();
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

  async savePlan(uid: string, plan: PlanInput, sessionId?: string): Promise<SessionPlan> {
    const id = await this.sessionIdOr(uid, sessionId);
    const ref = this.user(uid).collection("plans").doc();
    const ts = now();
    const doc = { ...plan, currentStage: 0, createdAt: ts, updatedAt: ts, sessionId: id };
    const batch = this.db.batch();
    batch.set(ref, doc);
    // update, not set: it fails when the session does not exist, so no plan is orphaned.
    batch.update(this.sessions(uid).doc(id), { planId: ref.id });
    await batch.commit();
    return { id: ref.id, ...doc };
  }

  async currentPlan(uid: string, sessionId?: string) {
    const session = sessionId ? await this.getSession(uid, sessionId) : await this.currentSession(uid);
    if (!session?.planId) return null;
    const doc = await this.user(uid).collection("plans").doc(session.planId).get();
    return doc.exists ? withId<SessionPlan>(doc) : null;
  }

  async updatePlan(uid: string, planId: string, patch: PlanPatch) {
    const ref = this.user(uid).collection("plans").doc(planId);
    await ref.update({ ...patch, updatedAt: now() });
    return withId<SessionPlan>(await ref.get());
  }

  async listSessions(uid: string): Promise<SessionSummary[]> {
    // Only the list fields: lastCode and lastError can be large, and the page fetches the list often.
    const snap = await this.sessions(uid)
      .orderBy("updatedAt", "desc")
      .select("name", "createdAt", "updatedAt", "versionCount", "planId")
      .get();
    return snap.docs.map((d) => {
      const s = toSession(d);
      return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        versionCount: s.versionCount,
        planId: s.planId,
      };
    });
  }

  async getSession(uid: string, id: string) {
    const doc = await this.sessions(uid).doc(id).get();
    return doc.exists ? toSession(doc) : null;
  }

  async currentSession(uid: string): Promise<Session> {
    const userDoc = await this.user(uid).get();
    const openId = userDoc.get("currentSessionId") as string | undefined;
    if (openId) {
      const open = await this.getSession(uid, openId);
      if (open) return open;
    }
    const newest = await this.sessions(uid).orderBy("updatedAt", "desc").limit(1).get();
    const doc = newest.docs[0];
    if (doc) {
      await this.user(uid).set({ currentSessionId: doc.id }, { merge: true });
      return toSession(doc);
    }
    return this.createUntitled(uid);
  }

  /**
   * The first load since sessions: "Untitled" claims every version and plan made before.
   * Its id is fixed, so two first loads at once make one session, and only one claims.
   */
  private async createUntitled(uid: string): Promise<Session> {
    const user = this.user(uid);
    const ref = this.sessions(uid).doc(UNTITLED_SESSION_ID);
    const ts = now();
    const [latest, latestPlan] = await Promise.all([
      user.collection("versions").orderBy("createdAt", "desc").limit(1).get(),
      user.collection("plans").orderBy("createdAt", "desc").limit(1).get(),
    ]);
    const top = latest.docs[0];
    const plan = latestPlan.docs[0];
    const session: Omit<Session, "id"> = {
      name: UNTITLED_SESSION_NAME,
      createdAt: ts,
      updatedAt: ts,
      lastCode: top && !top.get("sessionId") ? String(top.get("code") ?? "") : "",
      versionCount: 0,
      planId: plan && !plan.get("sessionId") ? plan.id : null,
    };
    try {
      await ref.create(session);
    } catch {
      // Another request made it first; that one claims the old documents.
      const made = await ref.get();
      if (made.exists) return toSession(made);
      throw new Error("could not create the Untitled session");
    }
    const claimed = await this.claim(user.collection("versions"), UNTITLED_SESSION_ID);
    await this.claim(user.collection("plans"), UNTITLED_SESSION_ID);
    await ref.update({ versionCount: FieldValue.increment(claimed) });
    await user.set({ currentSessionId: UNTITLED_SESSION_ID }, { merge: true });
    return { id: UNTITLED_SESSION_ID, ...session, versionCount: claimed };
  }

  /** Gives every document without a sessionId to the session. Reads only that field. */
  private async claim(collection: Query, sessionId: string) {
    const snap = await collection.select("sessionId").get();
    const loose = snap.docs.filter((d) => !d.get("sessionId"));
    for (let i = 0; i < loose.length; i += BATCH) {
      const batch = this.db.batch();
      for (const d of loose.slice(i, i + BATCH)) batch.update(d.ref, { sessionId });
      await batch.commit();
    }
    return loose.length;
  }

  async createSession(uid: string, input: { name: string; lastCode: string }): Promise<Session> {
    return this.newSession(uid, input, true);
  }

  private async newSession(uid: string, input: { name: string; lastCode: string }, open: boolean): Promise<Session> {
    const ref = this.sessions(uid).doc();
    const ts = now();
    const session = { ...input, createdAt: ts, updatedAt: ts, versionCount: 0, planId: null };
    const batch = this.db.batch();
    batch.set(ref, session);
    if (open) batch.set(this.user(uid), { currentSessionId: ref.id }, { merge: true });
    await batch.commit();
    return { id: ref.id, ...session };
  }

  async updateSession(uid: string, id: string, patch: SessionPatch) {
    const ref = this.sessions(uid).doc(id);
    try {
      await ref.update({ ...patch, updatedAt: now() });
    } catch {
      return null;
    }
    return toSession(await ref.get());
  }

  async openSession(uid: string, id: string, previous?: { id: string; lastCode: string }) {
    const ref = this.sessions(uid).doc(id);
    const leftRef = previous && previous.id !== id ? this.sessions(uid).doc(previous.id) : null;
    return this.db.runTransaction(async (tx) => {
      const target = await tx.get(ref);
      const left = leftRef ? await tx.get(leftRef) : null;
      if (!target.exists) return null;
      if (left?.exists && left.get("lastCode") !== previous?.lastCode) {
        tx.update(left.ref, { lastCode: previous?.lastCode, updatedAt: now() });
      }
      tx.set(this.user(uid), { currentSessionId: id }, { merge: true });
      return toSession(target);
    });
  }

  async duplicateSession(uid: string, id: string, name: string) {
    const source = await this.getSession(uid, id);
    if (!source) return null;
    // A copy is not opened: the user stays where they are.
    const copy = await this.newSession(uid, { name, lastCode: source.lastCode }, false);
    const plan = await this.currentPlan(uid, id);
    if (!plan) return copy;
    const saved = await this.savePlan(uid, { destination: plan.destination, stages: plan.stages }, copy.id);
    await this.updatePlan(uid, saved.id, {
      currentStage: plan.currentStage,
      ...(plan.note ? { note: plan.note } : {}),
    });
    return { ...copy, planId: saved.id };
  }

  async setSessionError(uid: string, id: string, error: SessionError | null) {
    try {
      // update, not set: it fails when the session does not exist.
      await this.sessions(uid).doc(id).update({ lastError: error });
      return true;
    } catch {
      return false;
    }
  }

  async deleteSession(uid: string, id: string) {
    const ref = this.sessions(uid).doc(id);
    if (!(await ref.get()).exists) return false;
    // Versions and plans go first, the session last: a half-finished delete leaves a session
    // the user can delete again, never versions without a session that a new one could pick up.
    const user = this.user(uid);
    for (const name of ["versions", "plans"] as const) {
      const query = user.collection(name).where("sessionId", "==", id).select().limit(BATCH);
      for (;;) {
        const snap = await query.get();
        if (snap.empty) break;
        const batch = this.db.batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
      }
    }
    await ref.delete();
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(user);
      if (doc.get("currentSessionId") === id) tx.update(user, { currentSessionId: FieldValue.delete() });
    });
    return true;
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
    const expireAt = new Date(client.clientIdIssuedAt * 1000 + UNCLAIMED_CLIENT_TTL_MS);
    await this.oauth("oauthClients")
      .doc(sha256(client.clientId))
      .set({ ...client, expireAt });
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

  async redeemAuthCode(hash: string, at: number, grantFor: (code: AuthCodeRecord) => GrantRecord | null) {
    const ref = this.oauth("oauthCodes").doc(hash);
    return this.db.runTransaction(async (tx) => {
      const found = record<AuthCodeRecord>(await tx.get(ref));
      if (!found || found.usedAt !== null) return found;
      const grant = grantFor(found);
      // Every read comes before the first write in a Firestore transaction.
      const clientRef = this.oauth("oauthClients").doc(sha256(found.clientId));
      const client = grant ? await tx.get(clientRef) : null;
      tx.update(ref, { usedAt: at });
      if (grant) {
        tx.set(this.oauth("oauthGrants").doc(grant.id), grant);
        if (client?.exists) tx.update(clientRef, { expireAt: FieldValue.delete() });
      }
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
