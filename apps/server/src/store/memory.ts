import { EventEmitter } from "node:events";
import {
  advanceCadence,
  COACH_PAGE_SEEN_WRITE_MS,
  DEFAULT_CADENCE_STATE,
  pickCoachEvent,
  UNTITLED_SESSION_ID,
  UNTITLED_SESSION_NAME,
  type AudioSnapshot,
  type CoachCadence,
  type CoachCadenceState,
  type CoachEvent,
  type CodeVersion,
  type PlanInput,
  type Session,
  type SessionError,
  type SessionPlan,
  type SessionSummary,
} from "@jam/shared";
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

/** An in-memory Store for tests and local runs. Never used in production. */
export class MemoryStore implements Store {
  readonly versions = new Map<string, CodeVersion[]>();
  readonly audio = new Map<string, AudioSnapshot[]>();
  readonly plans = new Map<string, SessionPlan[]>();
  readonly sessions = new Map<string, Session[]>();
  /** The open session per user (Firestore: users/{uid}.currentSessionId). */
  readonly current = new Map<string, string>();
  readonly tokens = new Map<string, TokenRecord>();
  readonly oauthClients = new Map<string, OAuthClientRecord>();
  readonly authRequests = new Map<string, AuthRequestRecord>();
  readonly authCodes = new Map<string, AuthCodeRecord>();
  readonly grants = new Map<string, GrantRecord>();
  readonly oauthTokens = new Map<string, OAuthTokenRecord>();
  /** Registered clients that no grant has claimed yet (Firestore: `expireAt` is set). */
  readonly unclaimedClients = new Set<string>();
  /** Coach events per user, oldest first. */
  readonly coachEvents = new Map<string, CoachEvent[]>();
  /** Cadence state per `${uid}/${sessionId}`. */
  readonly cadences = new Map<string, CoachCadenceState>();
  readonly listening = new Map<string, string>();
  /** When the page last polled the coach thread, per user. */
  readonly pageSeen = new Map<string, string>();
  /** When a session's coach thread last changed, per `${uid}/${sessionId}`. */
  readonly coachUpdated = new Map<string, string>();
  private readonly coachChanges = new EventEmitter();
  private seq = 0;

  private nextId() {
    return `id${++this.seq}`;
  }

  /** Strictly increasing, so ordering is stable inside one millisecond. */
  private nextTime() {
    return new Date(Date.UTC(2026, 0, 1) + ++this.seq * 1000).toISOString();
  }

  async saveVersion(uid: string, code: string, opts: { email?: string; sessionId?: string } = {}) {
    const session = opts.sessionId
      ? this.find(uid, opts.sessionId)
      : this.find(uid, (await this.currentSession(uid)).id);
    if (!session) return null;
    const list = this.versions.get(uid) ?? [];
    const top = list.find((v) => v.sessionId === session.id);
    const ts = this.nextTime();
    Object.assign(session, { lastCode: code, updatedAt: ts, lastError: null });
    this.current.set(uid, session.id);
    if (top && top.code === code) {
      top.evaluatedAt = ts;
      top.evalCount += 1;
      return { ...top };
    }
    const version = { id: this.nextId(), code, createdAt: ts, evaluatedAt: ts, evalCount: 1, sessionId: session.id };
    this.versions.set(uid, [version, ...list]);
    session.versionCount += 1;
    return { ...version };
  }

  async latestVersion(uid: string, sessionId?: string) {
    return (await this.listVersions(uid, 1, { sessionId }))[0] ?? null;
  }

  async listVersions(uid: string, limit: number, opts: { sessionId?: string; before?: string } = {}) {
    const sessionId = opts.sessionId ?? (await this.currentSession(uid)).id;
    const before = opts.before;
    return (this.versions.get(uid) ?? [])
      .filter((v) => v.sessionId === sessionId && (before === undefined || v.createdAt < before))
      .slice(0, limit)
      .map((v) => ({ ...v }));
  }

  async saveAudio(uid: string, snapshot: NewAudioSnapshot) {
    const saved = { ...snapshot, id: this.nextId(), createdAt: this.nextTime() };
    this.audio.set(uid, [saved, ...(this.audio.get(uid) ?? [])]);
    return { ...saved };
  }

  async listAudio(uid: string, limit: number) {
    return (this.audio.get(uid) ?? []).slice(0, limit).map((a) => ({ ...a }));
  }

  async savePlan(uid: string, plan: PlanInput, sessionId?: string) {
    const session = sessionId ? this.find(uid, sessionId) : this.find(uid, (await this.currentSession(uid)).id);
    if (!session) throw new Error(`session ${sessionId} not found`);
    const ts = this.nextTime();
    const saved: SessionPlan = {
      ...structuredClone(plan),
      id: this.nextId(),
      currentStage: 0,
      createdAt: ts,
      updatedAt: ts,
      sessionId: session.id,
    };
    this.plans.set(uid, [saved, ...(this.plans.get(uid) ?? [])]);
    session.planId = saved.id;
    return structuredClone(saved);
  }

  async currentPlan(uid: string, sessionId?: string) {
    const session = sessionId ? this.find(uid, sessionId) : await this.currentSession(uid);
    const plan = session?.planId ? this.plans.get(uid)?.find((p) => p.id === session.planId) : undefined;
    return plan ? structuredClone(plan) : null;
  }

  async updatePlan(uid: string, planId: string, patch: PlanPatch) {
    const plan = this.plans.get(uid)?.find((p) => p.id === planId);
    if (!plan) throw new Error(`plan ${planId} not found`);
    Object.assign(plan, patch, { updatedAt: this.nextTime() });
    return structuredClone(plan);
  }

  private find(uid: string, id: string) {
    return this.sessions.get(uid)?.find((x) => x.id === id) ?? null;
  }

  private newest(uid: string) {
    return [...(this.sessions.get(uid) ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listSessions(uid: string): Promise<SessionSummary[]> {
    return this.newest(uid).map(({ lastCode: _code, lastError: _error, ...rest }) => ({ ...rest }));
  }

  async getSession(uid: string, id: string) {
    const found = this.find(uid, id);
    return found ? { ...found } : null;
  }

  async currentSession(uid: string): Promise<Session> {
    const open = this.find(uid, this.current.get(uid) ?? "");
    if (open) return { ...open };
    const newest = this.newest(uid)[0];
    if (newest) {
      this.current.set(uid, newest.id);
      return { ...newest };
    }
    // First load since sessions: "Untitled" claims what was made before.
    const legacy = (this.versions.get(uid) ?? []).filter((v) => !v.sessionId);
    const plans = (this.plans.get(uid) ?? []).filter((p) => !p.sessionId);
    for (const v of legacy) v.sessionId = UNTITLED_SESSION_ID;
    for (const p of plans) p.sessionId = UNTITLED_SESSION_ID;
    const ts = this.nextTime();
    const untitled: Session = {
      id: UNTITLED_SESSION_ID,
      name: UNTITLED_SESSION_NAME,
      createdAt: ts,
      updatedAt: ts,
      lastCode: legacy[0]?.code ?? "",
      versionCount: legacy.length,
      planId: plans[0]?.id ?? null,
    };
    this.sessions.set(uid, [untitled]);
    this.current.set(uid, untitled.id);
    return { ...untitled };
  }

  async createSession(uid: string, input: { name: string; lastCode: string }) {
    const ts = this.nextTime();
    const session: Session = {
      id: this.nextId(),
      ...input,
      createdAt: ts,
      updatedAt: ts,
      versionCount: 0,
      planId: null,
    };
    this.sessions.set(uid, [session, ...(this.sessions.get(uid) ?? [])]);
    this.current.set(uid, session.id);
    return { ...session };
  }

  async updateSession(uid: string, id: string, patch: SessionPatch) {
    const found = this.find(uid, id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: this.nextTime() });
    return { ...found };
  }

  async openSession(uid: string, id: string, previous?: { id: string; lastCode: string }) {
    const target = this.find(uid, id);
    if (!target) return null;
    const left = previous && previous.id !== id ? this.find(uid, previous.id) : null;
    if (left && left.lastCode !== previous?.lastCode) {
      Object.assign(left, { lastCode: previous?.lastCode, updatedAt: this.nextTime() });
    }
    this.current.set(uid, id);
    return { ...target };
  }

  async duplicateSession(uid: string, id: string, name: string) {
    const source = this.find(uid, id);
    if (!source) return null;
    const open = this.current.get(uid);
    const copy = await this.createSession(uid, { name, lastCode: source.lastCode });
    // A copy is not opened: the user stays where they are.
    if (open) this.current.set(uid, open);
    const plan = await this.currentPlan(uid, source.id);
    if (plan) {
      const saved = await this.savePlan(uid, { destination: plan.destination, stages: plan.stages }, copy.id);
      await this.updatePlan(uid, saved.id, {
        currentStage: plan.currentStage,
        ...(plan.note ? { note: plan.note } : {}),
      });
    }
    return { ...(this.find(uid, copy.id) as Session) };
  }

  async setSessionError(uid: string, id: string, error: SessionError | null) {
    const found = this.find(uid, id);
    if (!found) return false;
    found.lastError = error ? { ...error } : null;
    return true;
  }

  async deleteSession(uid: string, id: string) {
    const list = this.sessions.get(uid) ?? [];
    if (!list.some((x) => x.id === id)) return false;
    this.sessions.set(
      uid,
      list.filter((x) => x.id !== id),
    );
    this.versions.set(
      uid,
      (this.versions.get(uid) ?? []).filter((v) => v.sessionId !== id),
    );
    this.plans.set(
      uid,
      (this.plans.get(uid) ?? []).filter((p) => p.sessionId !== id),
    );
    this.coachEvents.set(
      uid,
      (this.coachEvents.get(uid) ?? []).filter((e) => e.sessionId !== id),
    );
    this.cadences.delete(`${uid}/${id}`);
    this.coachUpdated.delete(`${uid}/${id}`);
    if (this.current.get(uid) === id) this.current.delete(uid);
    return true;
  }

  private touchPage(uid: string, at: number) {
    const seen = this.pageSeen.get(uid);
    if (!seen || at - Date.parse(seen) >= COACH_PAGE_SEEN_WRITE_MS) this.pageSeen.set(uid, new Date(at).toISOString());
  }

  async coachThread(uid: string, sessionId: string, limit: number, at: number) {
    if (!this.find(uid, sessionId)) return null;
    this.touchPage(uid, at);
    const events = (this.coachEvents.get(uid) ?? []).filter((e) => e.sessionId === sessionId);
    return {
      events: events.slice(-limit).map((e) => ({ ...e })),
      cadence: (this.cadences.get(`${uid}/${sessionId}`) ?? DEFAULT_CADENCE_STATE).cadence,
      listeningAt: this.listening.get(uid) ?? null,
      updatedAt: this.coachUpdated.get(`${uid}/${sessionId}`) ?? null,
    };
  }

  async coachStatus(uid: string, sessionId: string, at: number) {
    if (!this.find(uid, sessionId)) return null;
    this.touchPage(uid, at);
    return {
      listeningAt: this.listening.get(uid) ?? null,
      updatedAt: this.coachUpdated.get(`${uid}/${sessionId}`) ?? null,
    };
  }

  private changed(uid: string, sessionId: string, at: number) {
    this.coachUpdated.set(`${uid}/${sessionId}`, new Date(at).toISOString());
  }

  private sessionEvents(uid: string, sessionId: string) {
    return (this.coachEvents.get(uid) ?? []).filter((e) => e.sessionId === sessionId);
  }

  private pushCoachEvent(uid: string, event: Omit<CoachEvent, "id">, at: number): CoachEvent {
    const saved = { ...event, id: this.nextId() };
    this.coachEvents.set(uid, [...(this.coachEvents.get(uid) ?? []), saved]);
    this.changed(uid, event.sessionId, at);
    this.coachChanges.emit(`${uid}/${event.sessionId}`);
    return { ...saved };
  }

  async addCoachEvent(uid: string, sessionId: string, event: { kind: "ask" | "note"; text: string }, at: number) {
    if (!this.find(uid, sessionId)) return null;
    if (event.kind === "note") {
      for (const e of this.sessionEvents(uid, sessionId)) if (e.status === "taken") e.status = "done";
    }
    return this.pushCoachEvent(
      uid,
      { ...event, sessionId, createdAt: new Date(at).toISOString(), status: event.kind === "ask" ? "pending" : null },
      at,
    );
  }

  async setCoachCadence(uid: string, sessionId: string, cadence: CoachCadence) {
    if (!this.find(uid, sessionId)) return false;
    this.cadences.set(`${uid}/${sessionId}`, { ...DEFAULT_CADENCE_STATE, cadence });
    return true;
  }

  async tickCoach(uid: string, sessionId: string, at: number, run: boolean) {
    if (!this.find(uid, sessionId)) return null;
    const key = `${uid}/${sessionId}`;
    const { state, due } = advanceCadence(this.cadences.get(key) ?? DEFAULT_CADENCE_STATE, at, run);
    this.cadences.set(key, state);
    if (!due) return null;
    if (this.sessionEvents(uid, sessionId).some((e) => e.kind === "checkin" && e.status === "pending")) return null;
    return this.pushCoachEvent(
      uid,
      { sessionId, kind: "checkin", text: "", reason: due, createdAt: new Date(at).toISOString(), status: "pending" },
      at,
    );
  }

  async takeCoachEvent(uid: string, sessionId: string, at: number) {
    const { take, drop, giveUp } = pickCoachEvent(this.sessionEvents(uid, sessionId), at);
    if (drop.length > 0) {
      this.coachEvents.set(
        uid,
        (this.coachEvents.get(uid) ?? []).filter((e) => !drop.includes(e.id)),
      );
    }
    for (const e of this.sessionEvents(uid, sessionId)) if (giveUp.includes(e.id)) e.status = "done";
    if (take || drop.length > 0 || giveUp.length > 0) this.changed(uid, sessionId, at);
    if (!take) return null;
    const stored = this.sessionEvents(uid, sessionId).find((e) => e.id === take.id);
    if (!stored) return null;
    Object.assign(stored, { status: "taken", takenAt: new Date(at).toISOString(), takes: (stored.takes ?? 0) + 1 });
    return { ...stored };
  }

  async releaseCoachEvent(uid: string, sessionId: string, eventId: string, at: number) {
    const stored = this.sessionEvents(uid, sessionId).find((e) => e.id === eventId && e.status === "taken");
    if (!stored) return;
    Object.assign(stored, { status: "pending", takenAt: null, takes: Math.max(0, (stored.takes ?? 1) - 1) });
    this.changed(uid, sessionId, at);
  }

  async openCoachSessions(uid: string) {
    const ids = new Set<string>();
    for (const e of this.coachEvents.get(uid) ?? []) {
      if (e.status === "pending" || e.status === "taken") ids.add(e.sessionId);
    }
    return [...ids];
  }

  async touchCoachListening(uid: string, at: number) {
    this.listening.set(uid, new Date(at).toISOString());
  }

  async coachPageSeenAt(uid: string) {
    return this.pageSeen.get(uid) ?? null;
  }

  /** Open watchers, for tests that check wait_for_change cleans up. */
  coachWatchers() {
    return this.coachChanges.eventNames().reduce((n, name) => n + this.coachChanges.listenerCount(name), 0);
  }

  watchCoachEvents(uid: string, sessionId: string, onChange: () => void) {
    const name = `${uid}/${sessionId}`;
    this.coachChanges.on(name, onChange);
    return () => void this.coachChanges.off(name, onChange);
  }

  async createToken(hash: string, uid: string, label: string) {
    if (this.tokens.has(hash)) throw new Error("token exists");
    const record = { id: hash, uid, label, createdAt: this.nextTime(), lastUsedAt: null };
    this.tokens.set(hash, record);
    return { ...record };
  }

  async findToken(hash: string) {
    const record = this.tokens.get(hash);
    return record ? { ...record } : null;
  }

  async touchToken(hash: string) {
    const record = this.tokens.get(hash);
    if (record) record.lastUsedAt = this.nextTime();
  }

  async listTokens(uid: string) {
    return [...this.tokens.values()]
      .filter((t) => t.uid === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => ({ ...t }));
  }

  async deleteToken(uid: string, hash: string) {
    const record = this.tokens.get(hash);
    if (!record || record.uid !== uid) return false;
    return this.tokens.delete(hash);
  }

  async saveOAuthClient(client: OAuthClientRecord) {
    this.oauthClients.set(client.clientId, structuredClone(client));
    this.unclaimedClients.add(client.clientId);
  }

  async getOAuthClient(clientId: string) {
    const client = this.oauthClients.get(clientId);
    return client ? structuredClone(client) : null;
  }

  async saveAuthRequest(request: AuthRequestRecord) {
    this.authRequests.set(request.id, structuredClone(request));
  }

  async getAuthRequest(id: string) {
    const request = this.authRequests.get(id);
    return request ? structuredClone(request) : null;
  }

  async takeAuthRequest(id: string) {
    const request = this.authRequests.get(id);
    this.authRequests.delete(id);
    return request ? structuredClone(request) : null;
  }

  async saveAuthCode(code: AuthCodeRecord) {
    this.authCodes.set(code.hash, structuredClone(code));
  }

  async getAuthCode(hash: string) {
    const code = this.authCodes.get(hash);
    return code ? structuredClone(code) : null;
  }

  async redeemAuthCode(hash: string, at: number, grantFor: (code: AuthCodeRecord) => GrantRecord | null) {
    const code = this.authCodes.get(hash);
    if (!code) return null;
    const before = structuredClone(code);
    if (code.usedAt !== null) return before;
    const grant = grantFor(before);
    code.usedAt = at;
    if (grant) {
      this.grants.set(grant.id, structuredClone(grant));
      this.unclaimedClients.delete(grant.clientId);
    }
    return before;
  }

  async saveGrant(grant: GrantRecord) {
    this.grants.set(grant.id, structuredClone(grant));
  }

  async getGrant(id: string) {
    const grant = this.grants.get(id);
    return grant ? structuredClone(grant) : null;
  }

  async listGrants(uid: string) {
    return [...this.grants.values()]
      .filter((g) => g.uid === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((g) => structuredClone(g));
  }

  async touchGrant(id: string) {
    const grant = this.grants.get(id);
    if (grant) grant.lastUsedAt = this.nextTime();
  }

  async deleteGrant(id: string) {
    this.grants.delete(id);
    for (const [hash, token] of this.oauthTokens) if (token.grantId === id) this.oauthTokens.delete(hash);
  }

  async saveOAuthToken(token: OAuthTokenRecord) {
    this.oauthTokens.set(token.hash, structuredClone(token));
  }

  async getOAuthToken(hash: string) {
    const token = this.oauthTokens.get(hash);
    return token ? structuredClone(token) : null;
  }

  async rotateRefreshToken(hash: string, at: number) {
    const token = this.oauthTokens.get(hash);
    if (!token) return null;
    const before = structuredClone(token);
    if (token.kind === "refresh") token.rotatedAt ??= at;
    return before;
  }

  async deleteOAuthToken(hash: string) {
    this.oauthTokens.delete(hash);
  }
}
