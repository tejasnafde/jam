// The hidden render frame (/render.html). It loads its own copy of the Strudel REPL, so its
// superdough, node pools and AudioContext are this frame's alone: the page's live music is a
// different JavaScript realm and is never touched.
//
// It follows Strudel 1.3's renderPatternAudio, with three changes: nothing is closed (the frame's
// own idle context is simply replaced), no file is downloaded, and the audio comes back as a WAV.

import { SHARE_LIMITS } from "@jam/shared";
import type { StrudelEditorElement, StrudelMirror, StrudelState } from "@/features/editor/strudelTypes";
import { untilCycle } from "../capture";
import { computePeaks } from "../peaks";
import { shareWav } from "../wavFile";
import {
  BUILD_ID,
  FRAME_READY,
  isRenderRequest,
  type FrameReady,
  type RenderReply,
  type RenderRequest,
} from "./protocol";

/** Below this the render counts as silent. */
export const SOUND_THRESHOLD = 0.001;

interface Fractionish {
  valueOf(): number;
}
interface Hap {
  whole?: { begin: Fractionish } | null;
  duration: Fractionish;
  value: unknown;
  hasOnset(): boolean;
  ensureObjectValue(): void;
}
interface Pattern {
  queryArc(begin: number, end: number, state?: object): Hap[];
}

/** What the REPL's prebake puts on globalThis (superdough's exports, through @strudel/webaudio). */
interface Engine {
  samples(map: Record<string, string | string[]>): Promise<void>;
  setAudioContext(ctx: BaseAudioContext | null): unknown;
  setSuperdoughAudioController(c: null): unknown;
  initAudio(options?: object): Promise<void>;
  resetGlobalEffects(): void;
  superdough(value: unknown, t: number, duration: number, cps: number, cycle: number): Promise<void>;
}

type Mirror = StrudelMirror & {
  prebaked?: Promise<unknown>;
  repl?: NonNullable<StrudelMirror["repl"]> & { setCps?: (cps: number) => void; state?: StrudelState };
};

/** The code itself fails. */
class CodeError extends Error {}

const engine = () => globalThis as unknown as Engine;

let mirror: Promise<Mirror> | null = null;

/** One hidden REPL per frame: the same bundle the page plays with, so the sound is the same. */
function loadRepl(): Promise<Mirror> {
  mirror ??= (async () => {
    await import("@strudel/repl");
    const el = document.createElement("strudel-editor") as StrudelEditorElement;
    el.setAttribute("code", "// share render");
    document.body.appendChild(el);
    const m = el.editor as Mirror | undefined;
    if (!m?.repl) throw new Error("Strudel did not start in the render frame.");
    // Sample banks, drum machines and soundfonts are registered here.
    await m.prebaked;
    return m;
  })();
  return mirror;
}

/** Waits until every reverb has its impulse response: superdough builds it in the background. */
async function reverbsReady(convolvers: ConvolverNode[], limitMs = 5000) {
  const until = Date.now() + limitMs;
  while (convolvers.some((c) => !c.buffer) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
}

export async function render(req: RenderRequest, post: (r: RenderReply, transfer?: Transferable[]) => void) {
  const t0 = performance.now();
  const progress = (fraction: number) => post({ type: "progress", fraction });
  progress(0.02);
  const m = await loadRepl();
  const repl = m.repl;
  if (!repl?.evaluate || !repl.scheduler) throw new Error("Strudel did not start in the render frame.");
  // Library samples first, so s("name") is known when the code runs.
  if (Object.keys(req.sampleMap).length) await engine().samples(req.sampleMap);
  progress(0.1);

  repl.setCps?.(req.cps);
  await repl.evaluate(req.code, false);
  const evalError = repl.state?.evalError;
  if (evalError) throw new CodeError(`The code does not run: ${evalError.message}`);
  const cps = repl.scheduler.cps ?? req.cps;
  const pattern = untilCycle(repl.scheduler.pattern, req.cycles) as Pattern;

  const seconds = req.cycles / cps + req.tailSeconds;
  const sampleRate = 48_000;
  const frames = Math.ceil(seconds * sampleRate);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  // Every reverb this render makes, so it can wait for their impulse responses.
  const convolvers: ConvolverNode[] = [];
  const createConvolver = ctx.createConvolver.bind(ctx);
  ctx.createConvolver = () => {
    const node = createConvolver();
    convolvers.push(node);
    return node;
  };

  const e = engine();
  e.setAudioContext(ctx);
  e.setSuperdoughAudioController(null);
  e.resetGlobalEffects();
  await e.initAudio({});

  // In onset order, as renderPatternAudio does: `cut` and other graph state depend on it. Each call
  // waits for its sample to load, and the context has not started, so no first hit is late.
  const haps = pattern
    .queryArc(0, req.cycles, { _cps: cps })
    .filter((h) => h.hasOnset() && h.whole)
    .sort((a, b) => Number(a.whole?.begin) - Number(b.whole?.begin));
  let failed = 0;
  let firstError = "";
  for (const [i, hap] of haps.entries()) {
    try {
      hap.ensureObjectValue();
      const begin = Number(hap.whole?.begin);
      await e.superdough(hap.value, begin / cps, Number(hap.duration) / cps, cps, begin);
    } catch (err) {
      failed++;
      firstError ||= err instanceof Error ? err.message : String(err);
    }
    if (i % 16 === 0) progress(0.1 + 0.5 * (i / haps.length));
  }
  if (haps.length && failed === haps.length) throw new Error(firstError || "No sound could be played.");
  await reverbsReady(convolvers);
  progress(0.6);

  // Progress while it renders: the context stops at each step, reports, and goes on.
  const steps = 10;
  for (let s = 1; s < steps; s++) {
    const at = Math.floor((s * frames) / steps / 128) * 128;
    void ctx.suspend(at / sampleRate).then(() => {
      progress(0.6 + 0.35 * (s / steps));
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  e.setAudioContext(null);
  e.setSuperdoughAudioController(null);

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  let peak = 0;
  let first = -1;
  for (let i = 0; i < left.length; i++) {
    const v = Math.max(Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
    if (v > peak) peak = v;
    if (first < 0 && v > SOUND_THRESHOLD) first = i;
  }
  // The rendered buffer's own arrays, not copies: shareWav may mix into the left one in place, and
  // the buffer is not used again. A mono buffer gives the same array twice, which mixes to itself.
  const channels: [Float32Array, Float32Array] = [left, right];
  // Peaks first: shareWav may mix the channels down in place.
  const peaks = computePeaks(channels, SHARE_LIMITS.peaks).map((v) => Math.round(v * 1000) / 1000);
  const wav = await shareWav(channels, sampleRate).arrayBuffer();
  post(
    {
      type: "done",
      wav,
      peaks,
      stats: {
        cps,
        seconds: frames / sampleRate,
        sampleRate,
        peak,
        firstSoundSec: first < 0 ? -1 : first / sampleRate,
        renderMs: Math.round(performance.now() - t0),
        failed,
        firstError,
      },
    },
    [wav],
  );
}

/** Answers one request per message, on the port that came with it. Only the parent page may ask. */
export function listen() {
  window.addEventListener("message", (e: MessageEvent) => {
    const port = e.ports[0];
    if (e.source !== window.parent || e.origin !== location.origin || !port || !isRenderRequest(e.data)) return;
    const post = (r: RenderReply, transfer: Transferable[] = []) => port.postMessage(r, transfer);
    render(e.data, post).catch((err: unknown) => {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      post({ type: "error", message, codeError: err instanceof CodeError });
    });
  });
  window.parent.postMessage({ type: FRAME_READY, build: BUILD_ID } satisfies FrameReady, location.origin);
}
