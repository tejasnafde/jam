import type { AudioReading, AudioSnapshot, CodeVersion, PlanInput, SessionPlan } from "@jam/shared";

export interface TokenRecord {
  /** The SHA-256 hash of the token, which is also the document id. */
  id: string;
  uid: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type NewAudioSnapshot = AudioReading & { versionId: string | null; windowMs: number };
export type PlanPatch = Partial<Pick<SessionPlan, "currentStage" | "note">>;

/**
 * All persistent state. Cloud Run may run several instances, so nothing is
 * kept in process memory in production.
 */
export interface Store {
  /** Identical code to the latest version bumps its counter instead of adding a row. */
  saveVersion(uid: string, code: string, email?: string): Promise<CodeVersion>;
  latestVersion(uid: string): Promise<CodeVersion | null>;
  /** Newest first. */
  listVersions(uid: string, limit: number): Promise<CodeVersion[]>;
  saveAudio(uid: string, snapshot: NewAudioSnapshot): Promise<AudioSnapshot>;
  /** Newest first. */
  listAudio(uid: string, limit: number): Promise<AudioSnapshot[]>;
  /** Starts a new plan at stage 0. Older plans are kept. */
  savePlan(uid: string, plan: PlanInput): Promise<SessionPlan>;
  currentPlan(uid: string): Promise<SessionPlan | null>;
  updatePlan(uid: string, planId: string, patch: PlanPatch): Promise<SessionPlan>;
  createToken(hash: string, uid: string, label: string): Promise<TokenRecord>;
  findToken(hash: string): Promise<TokenRecord | null>;
  touchToken(hash: string): Promise<void>;
  listTokens(uid: string): Promise<TokenRecord[]>;
  /** False when the token does not exist or belongs to someone else. */
  deleteToken(uid: string, hash: string): Promise<boolean>;
}
