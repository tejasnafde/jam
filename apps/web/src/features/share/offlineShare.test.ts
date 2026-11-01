import { describe, expect, it, vi } from "vitest";
import { runOfflineShare, ShareCancelled, ShareProblem, type OfflineShareDeps, type ShareDraft } from "./offlineShare";
import { RenderCancelled, RenderTimeout, type RenderDone } from "./render/protocol";

const DRAFT: ShareDraft = {
  sessionId: "s1",
  versionId: "v1",
  code: '$: s("bd*4")',
  title: "intro",
  ownerName: "Tejas",
  bars: 24,
  cps: 0.5,
  showCode: false,
};

const done = (peak: number, cps = 0.625, failed = 0, firstError = ""): RenderDone => ({
  type: "done",
  wav: new ArrayBuffer(48),
  peaks: [0.2, 1],
  stats: { cps, seconds: 24 / cps + 2, sampleRate: 48_000, peak, firstSoundSec: 0, renderMs: 1200, failed, firstError },
});

function deps(render: OfflineShareDeps["render"], audible = true) {
  const client = {
    create: vi.fn(async () => ({ id: "sh1", uploadUrl: "https://up", url: "https://jam/s/sh1" })),
    put: vi.fn(async () => {}),
    ready: vi.fn(async () => ({ id: "sh1" }) as never),
    remove: vi.fn(async () => null),
  };
  return { client, render: vi.fn(render), liveAudible: async () => audible, sampleMap: { kick: "https://k" } };
}

describe("runOfflineShare", () => {
  it("renders, then creates, uploads and marks the share ready with the code's tempo", async () => {
    const d = deps(async () => done(0.5));
    const progress: number[] = [];
    const out = await runOfflineShare(DRAFT, d, (f) => progress.push(f), new AbortController().signal);
    expect(out.url).toBe("https://jam/s/sh1");
    expect(d.render.mock.calls[0]?.[0]).toMatchObject({ code: DRAFT.code, cycles: 24, cps: 0.5, tailSeconds: 2 });
    expect(d.client.create).toHaveBeenCalledWith(expect.objectContaining({ bars: 24, seconds: 38.4 }));
    expect(d.client.ready).toHaveBeenCalledWith("sh1", { peaks: [0.2, 1] });
    expect(progress.at(-1)).toBe(1);
  });

  it("offers real time on a timeout and creates nothing", async () => {
    const d = deps(async () => {
      throw new RenderTimeout(60);
    });
    const err = await runOfflineShare(DRAFT, d, () => {}, new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareProblem);
    expect((err as ShareProblem).offerRealtime).toBe(true);
    expect(d.client.create).not.toHaveBeenCalled();
  });

  it("offers real time for a silent render while the music is audible", async () => {
    const d = deps(async () => done(0));
    const err = await runOfflineShare(DRAFT, d, () => {}, new AbortController().signal).catch((e: unknown) => e);
    expect((err as ShareProblem).offerRealtime).toBe(true);
  });

  it("deletes the unfinished share when the upload fails, without offering real time", async () => {
    const d = deps(async () => done(0.5));
    d.client.put.mockRejectedValueOnce(new Error("Upload failed: HTTP 500"));
    const err = await runOfflineShare(DRAFT, d, () => {}, new AbortController().signal).catch((e: unknown) => e);
    expect((err as ShareProblem).offerRealtime).toBe(false);
    expect(d.client.remove).toHaveBeenCalledWith("sh1");
  });

  it("turns a cancelled render into ShareCancelled", async () => {
    const d = deps(async () => {
      throw new RenderCancelled();
    });
    await expect(runOfflineShare(DRAFT, d, () => {}, new AbortController().signal)).rejects.toBeInstanceOf(
      ShareCancelled,
    );
  });

  it("does not upload a partly failed render with a layer missing, and offers real time", async () => {
    const d = deps(async () => done(0.8, 0.625, 12, 'sound "kick" not found'));
    const err = await runOfflineShare(DRAFT, d, () => {}, new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareProblem);
    expect((err as ShareProblem).offerRealtime).toBe(true);
    expect((err as ShareProblem).message).toBe('12 notes could not play in the render: sound "kick" not found');
    expect(d.client.create).not.toHaveBeenCalled();
  });
});
