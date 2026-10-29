import type { CreateUploadUrlBody, RegisterSample, Sample, SampleWithUrl, UploadUrlResponse } from "@jam/shared";
import type { Api } from "./api";

/** A typed client for the sample library (/api/samples). */
export function samplesApi(api: Api) {
  const post = <T>(path: string, body: unknown) => api.request<T>(path, { method: "POST", body: JSON.stringify(body) });

  return {
    list: async () => (await api.request<{ samples: SampleWithUrl[] }>("/samples")).samples,
    uploadUrl: (body: CreateUploadUrlBody) => post<UploadUrlResponse>("/samples/upload-url", body),
    register: (body: RegisterSample) => post<Sample>("/samples", body),
    remove: (id: string) => api.request<null>(`/samples/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** PUTs the file to a signed upload URL. The Content-Type must match the one the URL was signed for. */
    async put(uploadUrl: string, file: Blob, contentType: Sample["contentType"]) {
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    },
  };
}

export type SamplesApi = ReturnType<typeof samplesApi>;
