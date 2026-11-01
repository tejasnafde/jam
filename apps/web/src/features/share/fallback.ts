// When the offline render cannot be used, and whether recording in real time is worth offering.

import { RenderCancelled, RenderFailed, RenderTimeout } from "./render/protocol";

/** A render whose loudest sample is below this is silent (about -60 dBFS). */
export const SILENT_PEAK = 0.001;

export type RenderOutcome =
  /** `failed`: notes that could not play, with the first error. Any of them means a missing layer. */
  { ok: true; peak: number; failed?: number; firstError?: string } | { ok: false; error: unknown };

export type FallbackDecision =
  | { kind: "upload" }
  | { kind: "cancelled" }
  /** The render cannot be used, and a real-time recording may work. */
  | { kind: "offerRealtime"; message: string }
  /** The render cannot be used, and a real-time recording would not help either. */
  | { kind: "fail"; message: string };

/**
 * `liveAudible`: the page's own music was audible when the share started. A silent render of
 * audible music means the render missed something, so the real-time recording is offered.
 */
export function decideFallback(outcome: RenderOutcome, liveAudible: boolean): FallbackDecision {
  if (outcome.ok) {
    const failed = outcome.failed ?? 0;
    // A link with a layer missing would be wrong without a word, so it is never uploaded.
    if (failed > 0) {
      const notes = failed === 1 ? "1 note" : `${failed} notes`;
      const why = outcome.firstError ? `: ${outcome.firstError}` : ".";
      return { kind: "offerRealtime", message: `${notes} could not play in the render${why}` };
    }
    if (outcome.peak >= SILENT_PEAK) return { kind: "upload" };
    if (liveAudible) return { kind: "offerRealtime", message: "The link came out silent, but your music plays." };
    return { kind: "fail", message: "The link came out silent. Check that the code makes a sound." };
  }
  const { error } = outcome;
  if (error instanceof RenderCancelled) return { kind: "cancelled" };
  if (error instanceof RenderFailed && error.codeError) return { kind: "fail", message: error.message };
  if (error instanceof RenderTimeout) return { kind: "offerRealtime", message: error.message };
  return { kind: "offerRealtime", message: error instanceof Error ? error.message : String(error) };
}
