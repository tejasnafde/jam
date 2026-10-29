import type { AudioReading, AudioSnapshot, CodeVersion, PlanInput, SessionPlan } from "@jam/shared";

export interface TokenRecord {
  /** The SHA-256 hash of the token, which is also the document id. */
  id: string;
  uid: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A registered OAuth client (dynamic registration) or a fetched client metadata document. */
export interface OAuthClientRecord {
  clientId: string;
  /** SHA-256 of the client secret. Null for a public client. */
  clientSecretHash: string | null;
  clientName: string | null;
  clientUri: string | null;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  scope: string | null;
  /** Seconds since the epoch, as RFC 7591 sends it. */
  clientIdIssuedAt: number;
}

/** An /authorize request that waits for the user on the consent page. */
export interface AuthRequestRecord {
  /** Random, sent to the consent page in its URL. Not a credential on its own. */
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: string[];
  resource: string;
  /** SHA-256 of the browser-binding cookie of the browser that started the request. */
  browserHash: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** An authorization code. Stored under the SHA-256 of the code. */
export interface AuthCodeRecord {
  hash: string;
  clientId: string;
  uid: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  expiresAt: number;
  /** Set when the code is exchanged. A second exchange is a replay. */
  usedAt: number | null;
}

/** One connected app: the result of one consent. Tokens hang off it. */
export interface GrantRecord {
  id: string;
  uid: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  resource: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** An OAuth access or refresh token. Stored under the SHA-256 of the token. */
export interface OAuthTokenRecord {
  hash: string;
  kind: "access" | "refresh";
  grantId: string;
  uid: string;
  clientId: string;
  scopes: string[];
  resource: string;
  expiresAt: number;
  /** Refresh tokens only: set when the token is exchanged. A second exchange is a replay. */
  rotatedAt: number | null;
}

export type NewAudioSnapshot = AudioReading & { versionId: string | null; windowMs: number };
export type PlanPatch = Partial<Pick<SessionPlan, "currentStage" | "note">>;

/**
 * All persistent state. Cloud Run may run several instances, so nothing is
 * kept in process memory in production.
 */
export interface Store extends OAuthStore {
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

/** OAuth state. Every token and code is stored by hash only. */
export interface OAuthStore {
  saveOAuthClient(client: OAuthClientRecord): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  saveAuthRequest(request: AuthRequestRecord): Promise<void>;
  getAuthRequest(id: string): Promise<AuthRequestRecord | null>;
  /** Atomically reads and deletes. Null when it does not exist (never made, or already decided). */
  takeAuthRequest(id: string): Promise<AuthRequestRecord | null>;
  saveAuthCode(code: AuthCodeRecord): Promise<void>;
  getAuthCode(hash: string): Promise<AuthCodeRecord | null>;
  /** Atomically marks the code used. Returns the record as it was before, so a replay shows `usedAt`. */
  useAuthCode(hash: string, at: number): Promise<AuthCodeRecord | null>;
  saveGrant(grant: GrantRecord): Promise<void>;
  getGrant(id: string): Promise<GrantRecord | null>;
  /** Newest first. */
  listGrants(uid: string): Promise<GrantRecord[]>;
  touchGrant(id: string): Promise<void>;
  /** Deletes the grant and every token issued under it. */
  deleteGrant(id: string): Promise<void>;
  saveOAuthToken(token: OAuthTokenRecord): Promise<void>;
  getOAuthToken(hash: string): Promise<OAuthTokenRecord | null>;
  /** Atomically marks a refresh token rotated. Returns the record as it was before. */
  rotateRefreshToken(hash: string, at: number): Promise<OAuthTokenRecord | null>;
  deleteOAuthToken(hash: string): Promise<void>;
}
