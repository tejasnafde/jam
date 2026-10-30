import type {
  CoachCadence,
  CoachEvent,
  CoachStatus,
  CoachThread,
  ConsentDecisionResponse,
  ConsentRequestInfo,
  GrantInfo,
  CreateTokenRequest,
  CreateTokenResponse,
  PrepRequestBody,
  PrepStatusResponse,
  SaveAudioRequest,
  SaveVersionResponse,
  Session,
  SessionListResponse,
  SessionPlan,
  TokenInfo,
  VersionPage,
} from "@jam/shared";

export type GetIdToken = () => Promise<string>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return new ApiError(res.status, body.message ?? body.error ?? `HTTP ${res.status}`);
}

/**
 * Reads a pending OAuth request for the consent page. It needs no sign-in:
 * the browser-binding cookie that /authorize set goes along on its own.
 */
export async function fetchConsentRequest(id: string, base = "/api"): Promise<ConsentRequestInfo> {
  const res = await fetch(`${base}/oauth/requests/${encodeURIComponent(id)}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ConsentRequestInfo;
}

/** A typed client for the page REST API. Every call carries the Firebase ID token. */
export function createApi(getIdToken: GetIdToken, base = "/api") {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await getIdToken()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) throw await failure(res);
    return (res.status === 204 ? null : await res.json()) as T;
  }
  const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
  const patch = <T>(path: string, body: unknown, init: RequestInit = {}) =>
    call<T>(path, { ...init, method: "PATCH", body: JSON.stringify(body) });
  const session = (id: string) => `/sessions/${encodeURIComponent(id)}`;

  return {
    /** The raw authenticated call, for feature clients such as samples-api. */
    request: call,
    saveVersion: (code: string, sessionId?: string) => post<SaveVersionResponse>("/versions", { code, sessionId }),
    listSessions: () => call<SessionListResponse>("/sessions"),
    createSession: (name: string, lastCode: string) => post<Session>("/sessions", { name, lastCode }),
    /** keepalive: the browser finishes the request after the tab closes. */
    updateSession: (id: string, body: { name?: string; lastCode?: string }, opts: { keepalive?: boolean } = {}) =>
      patch<Session>(session(id), body, opts.keepalive ? { keepalive: true } : {}),
    openSession: (id: string, previous?: { id: string; lastCode: string }) =>
      post<{ session: Session; plan: SessionPlan | null }>(`${session(id)}/open`, { previous }),
    duplicateSession: (id: string) => post<Session>(`${session(id)}/duplicate`, {}),
    deleteSession: (id: string) => call<null>(session(id), { method: "DELETE" }),
    reportError: (id: string, code: string, message: string) =>
      call<null>(`${session(id)}/error`, { method: "POST", body: JSON.stringify({ code, message }) }),
    sessionVersions: (id: string, before?: string | null) =>
      call<VersionPage>(`${session(id)}/versions${before ? `?before=${encodeURIComponent(before)}` : ""}`),
    coachThread: (id: string) => call<CoachThread>(`${session(id)}/coach`),
    coachStatus: (id: string) => call<CoachStatus>(`${session(id)}/coach/status`),
    /** Empty text is "Check my music". */
    askCoach: (id: string, text: string) => post<CoachEvent>(`${session(id)}/coach/asks`, { text }),
    setCoachCadence: (id: string, cadence: CoachCadence) =>
      call<null>(`${session(id)}/coach/cadence`, { method: "PUT", body: JSON.stringify({ cadence }) }),
    saveAudio: (snapshot: SaveAudioRequest) => post<{ id: string }>("/audio", snapshot),
    /** The plan of the given session, or of the open one. */
    currentPlan: (sessionId?: string | null) =>
      call<SessionPlan | null>(sessionId ? `/plan?session=${encodeURIComponent(sessionId)}` : "/plan"),
    listTokens: () => call<TokenInfo[]>("/tokens"),
    createToken: (body: CreateTokenRequest) => post<CreateTokenResponse>("/tokens", body),
    revokeToken: (id: string) => call<null>(`/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listGrants: () => call<GrantInfo[]>("/oauth/grants"),
    revokeGrant: (id: string) => call<null>(`/oauth/grants/${encodeURIComponent(id)}`, { method: "DELETE" }),
    decideConsent: (id: string, allow: boolean) =>
      post<ConsentDecisionResponse>(`/oauth/requests/${encodeURIComponent(id)}/decision`, { allow }),
    startPrep: (body: PrepRequestBody) => post<{ jobId: string }>("/prep", body),
    prepStatus: (jobId: string) => call<PrepStatusResponse>(`/prep/${encodeURIComponent(jobId)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
