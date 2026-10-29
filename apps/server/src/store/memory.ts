import type { AudioSnapshot, CodeVersion, PlanInput, SessionPlan } from "@jam/shared";
import type { NewAudioSnapshot, PlanPatch, Store, TokenRecord } from "./types.js";

/** An in-memory Store for tests and local runs. Never used in production. */
export class MemoryStore implements Store {
  readonly versions = new Map<string, CodeVersion[]>();
  readonly audio = new Map<string, AudioSnapshot[]>();
  readonly plans = new Map<string, SessionPlan[]>();
  readonly tokens = new Map<string, TokenRecord>();
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
}
