// When the offline render cannot be used, and whether recording in real time is worth offering.

import { RenderCancelled, RenderFailed, RenderTimeout } from "./render/protocol";

/** A render whose loudest sample is below this is silent (about -60 dBFS). */
export const SILENT_PEAK = 0.001;

export type RenderOutcome = { ok: true; peak: number } | { ok: false; error: unknown };

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
