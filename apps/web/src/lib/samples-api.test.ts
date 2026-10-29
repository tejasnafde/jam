import { SAMPLE_MAX_BYTES } from "@jam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { samplesApi } from "./samples-api";

afterEach(() => vi.unstubAllGlobals());

describe("samplesApi.put", () => {
  it("sends the size range header the upload URL was signed with", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await samplesApi({} as Api).put("https://signed", new Blob(["x"]), "audio/wav");
    expect(fetchMock).toHaveBeenCalledWith("https://signed", {
      method: "PUT",
      headers: { "Content-Type": "audio/wav", "x-goog-content-length-range": `0,${SAMPLE_MAX_BYTES}` },
      body: expect.any(Blob),
    });
  });
});
