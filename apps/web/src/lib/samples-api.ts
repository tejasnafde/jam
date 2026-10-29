// Typed client for the sample library REST API (see packages/shared/src/samples.ts).
import type { Sample } from "@jam/shared";
import { ApiError, type GetIdToken } from "./api";

export type SampleWithUrl = Sample & { url: string };
export type NewSample = Omit<Sample, "userId" | "createdAt">;

async function call<T>(getIdToken: GetIdToken, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await getIdToken()}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api/samples${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(res.status, body.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export const createUploadUrl = (getIdToken: GetIdToken, body: Pick<Sample, "name" | "contentType">) =>
  call<{ id: string; uploadUrl: string; storagePath: string }>(getIdToken, "/upload-url", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const registerSample = (getIdToken: GetIdToken, body: NewSample) =>
  call<Sample>(getIdToken, "", { method: "POST", body: JSON.stringify(body) });

export const listSamples = (getIdToken: GetIdToken) => call<{ samples: SampleWithUrl[] }>(getIdToken, "");

export const deleteSample = (getIdToken: GetIdToken, id: string) =>
  call<null>(getIdToken, `/${encodeURIComponent(id)}`, { method: "DELETE" });
