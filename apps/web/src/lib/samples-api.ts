import {
  UPLOAD_SIZE_HEADERS,
  type CreateUploadUrlBody,
  type RegisterSample,
  type Sample,
  type SampleWithUrl,
  type UploadUrlResponse,
} from "@jam/shared";
import type { Api } from "./api";

/** A typed client for the sample library (/api/samples). */
export function samplesApi(api: Api) {
  const post = <T>(path: string, body: unknown) => api.request<T>(path, { method: "POST", body: JSON.stringify(body) });

  return {
    list: async () => (await api.request<{ samples: SampleWithUrl[] }>("/samples")).samples,
    uploadUrl: (body: CreateUploadUrlBody) => post<UploadUrlResponse>("/samples/upload-url", body),
    register: (body: RegisterSample) => post<Sample>("/samples", body),
    remove: (id: string) => api.request<null>(`/samples/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** PUTs the file to a signed upload URL. The headers must match the ones the URL was signed with. */
    async put(uploadUrl: string, file: Blob, contentType: Sample["contentType"]) {
      const headers = { "Content-Type": contentType, ...UPLOAD_SIZE_HEADERS };
      const res = await fetch(uploadUrl, { method: "PUT", headers, body: file });
      if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    },
  };
}

export type SamplesApi = ReturnType<typeof samplesApi>;
