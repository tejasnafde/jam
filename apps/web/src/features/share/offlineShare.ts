// Share without blocking: render the pass offline in the hidden frame, then the same upload and
// share creation as the real-time path. The page's music keeps playing the whole time.

import { SHARE_LIMITS, type CreateShareResponse, type Share } from "@jam/shared";
import type { SharesApi } from "@/lib/share-api";
import { decideFallback } from "./fallback";
import type { RenderDone, RenderRequest, TalkOptions } from "./render/protocol";

/** What the dialog hands over when it closes. */
export interface ShareDraft {
  sessionId: string;
  versionId: string;
  code: string;
  title: string;
  ownerName: string;
  bars: number;
  /** The tempo the page plays at now. A setcps in the code still wins. */
  cps: number;
  showCode: boolean;
}

/** The share could not be made. `offerRealtime`: recording it in real time may still work. */
export class ShareProblem extends Error {
  constructor(
    message: string,
    readonly offerRealtime: boolean,
  ) {
    super(message);
  }
}

export class ShareCancelled extends Error {
  constructor() {
    super("Share cancelled.");
  }
}

export interface OfflineShareDeps {
  client: Pick<SharesApi, "create" | "put" | "ready" | "remove">;
  render: (request: Omit<RenderRequest, "type">, options: Partial<TalkOptions>) => Promise<RenderDone>;
  /** True when the page's own music is audible now. */
  liveAudible: () => Promise<boolean>;
  sampleMap: Record<string, string | string[]>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Renders, checks, uploads and marks the share ready. Progress goes from 0 to 1. */
export async function runOfflineShare(
  draft: ShareDraft,
  deps: OfflineShareDeps,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ share: Share; url: string }> {
  const audible = deps.liveAudible().catch(() => false);
  let done: RenderDone | null = null;
  let error: unknown = null;
  try {
    done = await deps.render(
      {
        code: draft.code,
        cycles: draft.bars,
        cps: draft.cps,
        tailSeconds: SHARE_LIMITS.tailSeconds,
        sampleMap: deps.sampleMap,
      },
      { onProgress: (f) => onProgress(f * 0.9), signal },
    );
  } catch (err) {
    error = err;
  }
  const outcome = done
    ? { ok: true as const, peak: done.stats.peak, failed: done.stats.failed, firstError: done.stats.firstError }
    : { ok: false as const, error };
  const decision = decideFallback(outcome, await audible);
  if (decision.kind === "cancelled") throw new ShareCancelled();
  if (decision.kind !== "upload" || !done) {
    if (error) console.error(error);
    const text = decision.kind === "upload" ? "The render failed." : decision.message;
    throw new ShareProblem(text, decision.kind === "offerRealtime");
  }

  let started: CreateShareResponse | null = null;
  try {
    started = await deps.client.create({
      sessionId: draft.sessionId,
      versionId: draft.versionId,
      title: draft.title,
      ownerName: draft.ownerName,
      bars: draft.bars,
      seconds: Math.round((draft.bars / done.stats.cps) * 100) / 100,
      showCode: draft.showCode,
    });
    onProgress(0.93);
    await deps.client.put(started.uploadUrl, new Blob([done.wav], { type: "audio/wav" }), signal);
    onProgress(0.98);
    const share = await deps.client.ready(started.id, { peaks: done.peaks });
    onProgress(1);
    return { share, url: started.url };
  } catch (err) {
    // An unfinished share is deleted with any file it has, so it never lingers.
    if (started) void deps.client.remove(started.id).catch(console.error);
    if (signal.aborted) throw new ShareCancelled();
    throw new ShareProblem(message(err), false);
  }
}
