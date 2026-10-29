import type {
  CodeVersion,
  ConsentDecisionResponse,
  ConsentRequestInfo,
  GrantInfo,
  CreateTokenRequest,
  CreateTokenResponse,
  SaveAudioRequest,
  SaveVersionResponse,
  SessionPlan,
  TokenInfo,
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

  return {
    saveVersion: (code: string) => post<SaveVersionResponse>("/versions", { code }),
    latestVersion: () => call<CodeVersion | null>("/versions/latest"),
    saveAudio: (snapshot: SaveAudioRequest) => post<{ id: string }>("/audio", snapshot),
    currentPlan: () => call<SessionPlan | null>("/plan"),
    listTokens: () => call<TokenInfo[]>("/tokens"),
    createToken: (body: CreateTokenRequest) => post<CreateTokenResponse>("/tokens", body),
    revokeToken: (id: string) => call<null>(`/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listGrants: () => call<GrantInfo[]>("/oauth/grants"),
    revokeGrant: (id: string) => call<null>(`/oauth/grants/${encodeURIComponent(id)}`, { method: "DELETE" }),
    decideConsent: (id: string, allow: boolean) =>
      post<ConsentDecisionResponse>(`/oauth/requests/${encodeURIComponent(id)}/decision`, { allow }),
  };
}

export type Api = ReturnType<typeof createApi>;
