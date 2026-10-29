import type { AudioSnapshot, CodeVersion, PlanInput, SessionPlan } from "@jam/shared";
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

/** An in-memory Store for tests and local runs. Never used in production. */
export class MemoryStore implements Store {
  readonly versions = new Map<string, CodeVersion[]>();
  readonly audio = new Map<string, AudioSnapshot[]>();
  readonly plans = new Map<string, SessionPlan[]>();
  readonly tokens = new Map<string, TokenRecord>();
  readonly oauthClients = new Map<string, OAuthClientRecord>();
  readonly authRequests = new Map<string, AuthRequestRecord>();
  readonly authCodes = new Map<string, AuthCodeRecord>();
  readonly grants = new Map<string, GrantRecord>();
  readonly oauthTokens = new Map<string, OAuthTokenRecord>();
  private seq = 0;

  private nextId() {
    return `id${++this.seq}`;
  }

  /** Strictly increasing, so ordering is stable inside one millisecond. */
  private nextTime() {
    return new Date(Date.UTC(2026, 0, 1) + ++this.seq * 1000).toISOString();
  }

  async saveVersion(uid: string, code: string) {
    const list = this.versions.get(uid) ?? [];
    const top = list[0];
    const ts = this.nextTime();
    if (top && top.code === code) {
      top.evaluatedAt = ts;
      top.evalCount += 1;
      return { ...top };
    }
    const version = { id: this.nextId(), code, createdAt: ts, evaluatedAt: ts, evalCount: 1 };
    this.versions.set(uid, [version, ...list]);
    return { ...version };
  }

  async latestVersion(uid: string) {
    return (await this.listVersions(uid, 1))[0] ?? null;
  }

  async listVersions(uid: string, limit: number) {
    return (this.versions.get(uid) ?? []).slice(0, limit).map((v) => ({ ...v }));
  }

  async saveAudio(uid: string, snapshot: NewAudioSnapshot) {
    const saved = { ...snapshot, id: this.nextId(), createdAt: this.nextTime() };
    this.audio.set(uid, [saved, ...(this.audio.get(uid) ?? [])]);
    return { ...saved };
  }

  async listAudio(uid: string, limit: number) {
    return (this.audio.get(uid) ?? []).slice(0, limit).map((a) => ({ ...a }));
  }

  async savePlan(uid: string, plan: PlanInput) {
    const ts = this.nextTime();
    const saved: SessionPlan = {
      ...structuredClone(plan),
      id: this.nextId(),
      currentStage: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    this.plans.set(uid, [saved, ...(this.plans.get(uid) ?? [])]);
    return structuredClone(saved);
  }

  async currentPlan(uid: string) {
    const plan = this.plans.get(uid)?.[0];
    return plan ? structuredClone(plan) : null;
  }

  async updatePlan(uid: string, planId: string, patch: PlanPatch) {
    const plan = this.plans.get(uid)?.find((p) => p.id === planId);
    if (!plan) throw new Error(`plan ${planId} not found`);
    Object.assign(plan, patch, { updatedAt: this.nextTime() });
    return structuredClone(plan);
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

  async useAuthCode(hash: string, at: number) {
    const code = this.authCodes.get(hash);
    if (!code) return null;
    const before = structuredClone(code);
    code.usedAt ??= at;
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
