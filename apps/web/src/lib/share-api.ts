import {
  SHARE_UPLOAD_HEADERS,
  type CreateShareRequest,
  type CreateShareResponse,
  type PublicShare,
  type Share,
  type ShareListResponse,
  type UpdateShareRequest,
} from "@jam/shared";
import { ApiError, type Api } from "./api";

/** A typed client for the owner's share links (/api/shares). */
export function sharesApi(api: Api) {
  const send = <T>(method: string, path: string, body?: unknown) =>
    api.request<T>(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });

  return {
    list: async () => (await api.request<ShareListResponse>("/shares")).shares,
    create: (body: CreateShareRequest) => send<CreateShareResponse>("POST", "/shares", body),
    ready: (id: string) => send<Share>("POST", `/shares/${encodeURIComponent(id)}/ready`),
    update: (id: string, body: UpdateShareRequest) => send<Share>("PATCH", `/shares/${encodeURIComponent(id)}`, body),
    /** PUTs the WAV to the signed URL, with the size header the URL was signed with. */
    async put(uploadUrl: string, file: Blob, signal?: AbortSignal) {
      const headers = { "Content-Type": "audio/wav", ...SHARE_UPLOAD_HEADERS };
      const res = await fetch(uploadUrl, { method: "PUT", headers, body: file, signal });
      if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    },
  };
}

export type SharesApi = ReturnType<typeof sharesApi>;

/** The page link of a share, on this site. */
export const shareLink = (id: string, origin = window.location.origin) => `${origin}/s/${id}`;

/** The listener page's read. No sign-in. A 404 means the link is missing or turned off. */
export async function fetchPublicShare(id: string, base = "/api"): Promise<PublicShare> {
  const res = await fetch(`${base}/public/shares/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as PublicShare;
}

/** Counts one play. Best effort. */
export function countPlay(id: string, base = "/api") {
  return fetch(`${base}/public/shares/${encodeURIComponent(id)}/plays`, { method: "POST" }).catch(() => undefined);
}
