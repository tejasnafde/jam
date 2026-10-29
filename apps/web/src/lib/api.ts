import type {
  CodeVersion,
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

/** A typed client for the page REST API. Every call carries the Firebase ID token. */
export function createApi(getIdToken: GetIdToken, base = "/api") {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await getIdToken()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new ApiError(res.status, body.message ?? body.error ?? `HTTP ${res.status}`);
    }
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
  };
}

export type Api = ReturnType<typeof createApi>;
