import type {
  AudioReading,
  CoachCadence,
  CoachEvent,
  CoachStatus,
  CoachThread,
  AudioSnapshot,
  CodeVersion,
  PlanInput,
  Session,
  SessionError,
  SessionPlan,
  SessionSummary,
} from "@jam/shared";

export interface TokenRecord {
  /** The SHA-256 hash of the token, which is also the document id. */
  id: string;
  uid: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** How long a registered client lives when no grant claims it. */
export const UNCLAIMED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

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
export type SessionPatch = Partial<Pick<Session, "name" | "lastCode">>;
export type PlanPatch = Partial<Pick<SessionPlan, "currentStage" | "note">>;

/**
 * The coach thread of a session (users/{uid}/sessions/{id}/coachEvents in Firestore). The session
 * keeps `coachUpdatedAt` (when the thread last changed) and `coachOpen` (it has pending or taken,
 * unanswered events), so the page and a waiting coach read one field instead of the thread.
 */
export interface CoachStore {
  /**
   * The newest `limit` events, oldest first, with the cadence and the listening heartbeat. Null when
   * the session does not exist. The page reads it, so it records pageSeenAt (at most once a minute).
   */
  coachThread(uid: string, sessionId: string, limit: number, at: number): Promise<CoachThread | null>;
  /** When the thread last changed and when a coach last waited. Records pageSeenAt like coachThread. */
  coachStatus(uid: string, sessionId: string, at: number): Promise<CoachStatus | null>;
  /**
   * Adds an ask (pending, for a coach to take) or a coach note. A note makes the session's taken
   * events done. Null when the session does not exist.
   */
  addCoachEvent(
    uid: string,
    sessionId: string,
    event: { kind: "ask" | "note"; text: string },
    at: number,
  ): Promise<CoachEvent | null>;
  /** Sets the cadence and starts counting again. False when the session does not exist. */
  setCoachCadence(uid: string, sessionId: string, cadence: CoachCadence): Promise<boolean>;
  /**
   * Moves the session's cadence on: by one run (run: true), or only by the clock. Adds a pending
   * check-in when one is due and none is pending already. Returns the check-in it added, or null.
   */
  tickCoach(uid: string, sessionId: string, at: number, run: boolean): Promise<CoachEvent | null>;
  /** Atomically applies pickCoachEvent to the session's open events and returns the event it took. */
  takeCoachEvent(uid: string, sessionId: string, at: number): Promise<CoachEvent | null>;
  /** Puts a taken event back to pending, when its result never reached the coach. */
  releaseCoachEvent(uid: string, sessionId: string, eventId: string, at: number): Promise<void>;
  /** The ids of the user's sessions with open events. */
  openCoachSessions(uid: string): Promise<string[]>;
  /** Records that a coach is waiting for this user's events now. */
  touchCoachListening(uid: string, at: number): Promise<void>;
  /** When the page last polled the coach thread, or null. */
  coachPageSeenAt(uid: string): Promise<string | null>;
  /**
   * Calls onChange when the session's thread may have a new pending event. Returns the stop
   * function. A spurious call is fine: the waiter checks again.
   */
  watchCoachEvents(uid: string, sessionId: string, onChange: () => void): () => void;
}

/**
 * All persistent state. Cloud Run may run several instances, so nothing is
 * kept in process memory in production.
 */
export interface Store extends OAuthStore, CoachStore {
  /**
   * Saves an evaluation in a session (the current one when sessionId is left out) and
   * makes it the session's lastCode. A good evaluation clears the session's lastError. Identical code to the session's latest version bumps
   * its counter instead of adding a row. Null when the session does not exist.
   */
  saveVersion(uid: string, code: string, opts?: { email?: string; sessionId?: string }): Promise<CodeVersion | null>;
  /** The latest version of a session, the current one by default. */
  latestVersion(uid: string, sessionId?: string): Promise<CodeVersion | null>;
  /** Newest first, in one session (the current one by default). `before` is a createdAt cursor. */
  listVersions(uid: string, limit: number, opts?: { sessionId?: string; before?: string }): Promise<CodeVersion[]>;
  saveAudio(uid: string, snapshot: NewAudioSnapshot): Promise<AudioSnapshot>;
  /** Newest first. */
  listAudio(uid: string, limit: number): Promise<AudioSnapshot[]>;
  /** Starts a new plan at stage 0 for a session (the current one by default). Older plans are kept. */
  savePlan(uid: string, plan: PlanInput, sessionId?: string): Promise<SessionPlan>;
  /** The plan of a session, the current one by default. */
  currentPlan(uid: string, sessionId?: string): Promise<SessionPlan | null>;
  updatePlan(uid: string, planId: string, patch: PlanPatch): Promise<SessionPlan>;
  /** Newest edit first. Light: no lastCode and no lastError. */
  listSessions(uid: string): Promise<SessionSummary[]>;
  getSession(uid: string, id: string): Promise<Session | null>;
  /**
   * The session the user has open. When none is set, the most recently edited one. When the
   * user has none, an "Untitled" session is made, and it claims every version and plan from
   * before sessions.
   */
  currentSession(uid: string): Promise<Session>;
  /** Makes a session and opens it. */
  createSession(uid: string, input: { name: string; lastCode: string }): Promise<Session>;
  /** Null when the session does not exist (or belongs to someone else). */
  updateSession(uid: string, id: string, patch: SessionPatch): Promise<Session | null>;
  /** Saves the editor text of the session the user leaves, then makes `id` current. */
  openSession(uid: string, id: string, previous?: { id: string; lastCode: string }): Promise<Session | null>;
  /** A copy of the code and the plan under a new name. Versions stay with the original. */
  duplicateSession(uid: string, id: string, name: string): Promise<Session | null>;
  /** Saves (or with null clears) the session's last failed evaluation. False when the session does not exist. */
  setSessionError(uid: string, id: string, error: SessionError | null): Promise<boolean>;
  /** Deletes the session with its versions and plans. False when it does not exist. */
  deleteSession(uid: string, id: string): Promise<boolean>;
  createToken(hash: string, uid: string, label: string): Promise<TokenRecord>;
  findToken(hash: string): Promise<TokenRecord | null>;
  touchToken(hash: string): Promise<void>;
  listTokens(uid: string): Promise<TokenRecord[]>;
  /** False when the token does not exist or belongs to someone else. */
  deleteToken(uid: string, hash: string): Promise<boolean>;
}

/** OAuth state. Every token and code is stored by hash only. */
export interface OAuthStore {
  /**
   * Saves a registered client. A client that no grant claims within
   * UNCLAIMED_CLIENT_TTL_MS is deleted (Firestore TTL on `expireAt`), so
   * registrations that never lead to a consent do not pile up.
   */
  saveOAuthClient(client: OAuthClientRecord): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  saveAuthRequest(request: AuthRequestRecord): Promise<void>;
  getAuthRequest(id: string): Promise<AuthRequestRecord | null>;
  /** Atomically reads and deletes. Null when it does not exist (never made, or already decided). */
  takeAuthRequest(id: string): Promise<AuthRequestRecord | null>;
  saveAuthCode(code: AuthCodeRecord): Promise<void>;
  getAuthCode(hash: string): Promise<AuthCodeRecord | null>;
  /**
   * Atomically marks the code used. When the code was unused and `grantFor`
   * returns a grant, the same transaction saves the grant and claims the
   * client (it no longer expires). So a replay of the code always finds the
   * grant to revoke. Returns the code as it was before, so a replay shows `usedAt`.
   */
  redeemAuthCode(
    hash: string,
    at: number,
    grantFor: (code: AuthCodeRecord) => GrantRecord | null,
  ): Promise<AuthCodeRecord | null>;
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
