// Records one pass of the playing pattern from Strudel's real output, from cycle 0.
//
// Why real time and not an offline render: @strudel/webaudio 1.3 has renderPatternAudio, but it
// closes the live AudioContext, always starts a file download and never returns the audio.
// Rebuilding it from the globals is not safe either: superdough keeps one pool of reusable
// nodes (filters, compressors) for all contexts, so nodes from an offline render would end up
// in the live graph and the other way round. Recording the tap gets exactly what the user hears.
// Share now renders offline first, in a hidden frame with its own superdough (render/frame.ts);
// this real-time path is the fallback when that render fails or comes out silent.

import { connectUntapped, musicTap } from "@/lib/audio";
import type { Scheduler } from "@/features/editor/strudelTypes";

/** Collects the tap in blocks of BLOCK frames, each with the audio frame it starts at. */
const WORKLET = `
const BLOCK = 4096;
class JamShareRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.reset();
    this.port.onmessage = (e) => { if (e.data === "stop") { this.flush(); this.on = false; } };
  }
  reset() { this.l = new Float32Array(BLOCK); this.r = new Float32Array(BLOCK); this.n = 0; this.start = -1; }
  flush() {
    if (this.n === 0) return;
    const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n);
    this.port.postMessage({ frame: this.start, l, r }, [l.buffer, r.buffer]);
    this.reset();
  }
  process(inputs) {
    const input = inputs[0] || [];
    const frames = (input[0] && input[0].length) || 128;
    if (this.start < 0) this.start = currentFrame;
    if (this.n + frames > BLOCK) { this.flush(); this.start = currentFrame; }
    if (input[0]) {
      this.l.set(input[0], this.n);
      this.r.set(input[1] || input[0], this.n);
    }
    this.n += frames;
    return this.on;
  }
}
registerProcessor("jam-share-recorder", JamShareRecorder);
`;

const loaded = new WeakSet<BaseAudioContext>();

async function loadWorklet(ctx: AudioContext) {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
    loaded.add(ctx);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Block {
  frame: number;
  l: Float32Array;
  r: Float32Array;
}

/**
 * Places the recorded blocks on one timeline from startFrame; gaps (no input) stay silent.
 * It empties `blocks` as it goes, so a long pass is not held twice in memory.
 */
export function assemble(blocks: Block[], startFrame: number, frames: number): [Float32Array, Float32Array] {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  blocks.reverse();
  for (let b = blocks.pop(); b; b = blocks.pop()) {
    const from = Math.max(0, startFrame - b.frame);
    const at = b.frame + from - startFrame;
    const count = Math.min(b.l.length - from, frames - at);
    if (count <= 0) continue;
    left.set(b.l.subarray(from, from + count), at);
    right.set(b.r.subarray(from, from + count), at);
  }
  return [left, right];
}

export interface CaptureProgress {
  /** Seconds of music recorded so far, 0..seconds. */
  elapsed: number;
  /** True while the reverb tail is recorded after the last bar. */
  tail: boolean;
}

export interface Recording {
  channels: [Float32Array, Float32Array];
  sampleRate: number;
}

export class CaptureCancelled extends Error {
  constructor() {
    super("Recording cancelled.");
  }
}

/** The tab was hidden: the browser slows the scheduler there, so notes drop out of the recording. */
export const HIDDEN_TAB_MESSAGE = "The tab was hidden, so notes would drop out. Keep this tab open while it records.";

interface Fractionish {
  valueOf(): number;
}

/** The parts of a Strudel hap and pattern that untilCycle needs. */
export interface HapLike {
  whole?: { begin: Fractionish } | null;
  part: { begin: Fractionish };
}
export interface PatternLike {
  filterHaps(test: (hap: HapLike) => boolean): unknown;
}

/**
 * The pattern without any hap that starts at or after `cycles`. The scheduler queries about 0.3 s
 * ahead, so stopping it on time is not enough: the next bar's first hit would already be queued.
 */
export function untilCycle(pattern: unknown, cycles: number): unknown {
  return (pattern as PatternLike).filterHaps((hap) => Number((hap.whole ?? hap.part).begin) < cycles);
}

export interface PassLength {
  /** Cycles (bars) to play from cycle 0. */
  cycles: number;
  /** The same length in seconds at the current tempo. */
  seconds: number;
  /** Fade recorded after the last bar. */
  tailSeconds: number;
}

/**
 * Restarts the scheduler at cycle 0 with a copy of the pattern that ends after `cycles`, records
 * `seconds` of music plus `tailSeconds` of fade, then puts the pattern and the playback back as they
 * were (music on again from bar 1 when it was on). Nothing is evaluated again.
 */
export async function capturePass(
  scheduler: Scheduler,
  { cycles, seconds, tailSeconds }: PassLength,
  onProgress: (p: CaptureProgress) => void,
  signal: AbortSignal,
): Promise<Recording> {
  const music = musicTap();
  if (!music || !scheduler.pattern) throw new Error("Play the code once, then share it.");
  const { ctx, tap } = music;
  if (ctx.state !== "running") await ctx.resume();
  await loadWorklet(ctx);

  const node = new AudioWorkletNode(ctx, "jam-share-recorder", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
  });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const blocks: Block[] = [];
  node.port.onmessage = (e: MessageEvent<Block>) => blocks.push(e.data);
  // Through a silent gain to the speakers, so the browser keeps pulling the recorder.
  tap.connect(node);
  connectUntapped(node, mute);
  connectUntapped(mute, ctx.destination);

  const cleanup = () => {
    node.port.postMessage("stop");
    try {
      tap.disconnect(node);
    } catch {
      // Already gone.
    }
    node.disconnect();
    mute.disconnect();
  };

  const original = scheduler.pattern;
  const wasPlaying = !!scheduler.started;
  const pass = untilCycle(original, cycles);
  let hidden = false;
  const onVisibility = () => {
    if (document.hidden) hidden = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  const interrupted = () => {
    if (signal.aborted) return new CaptureCancelled();
    if (hidden || document.hidden) return new Error(HIDDEN_TAB_MESSAGE);
    return null;
  };
  /** Puts the user's pattern back, and the music on again (from bar 1) when it was on before. */
  const restore = async () => {
    document.removeEventListener("visibilitychange", onVisibility);
    scheduler.stop();
    // A pattern evaluated while it recorded stays; only the cut copy is undone.
    if (scheduler.pattern === pass) scheduler.pattern = original;
    if (wasPlaying) await Promise.resolve(scheduler.start()).catch(console.error);
  };

  try {
    scheduler.stop();
    scheduler.pattern = pass;
    scheduler.seconds_at_cps_change = undefined;
    const pressed = ctx.currentTime;
    await scheduler.start();
    // The scheduler sets the time of cycle 0 on its first tick.
    const t0 = await new Promise<number>((resolve, reject) => {
      const check = () => {
        const stop = interrupted();
        if (stop) return reject(stop);
        const at = scheduler.seconds_at_cps_change;
        if (typeof at === "number" && (scheduler.num_ticks_since_cps_change ?? 1) > 0) {
          return resolve(at + (scheduler.latency ?? 0.1));
        }
        if (ctx.currentTime - pressed > 2) return resolve(pressed + (scheduler.latency ?? 0.1));
        setTimeout(check, 10);
      };
      check();
    });

    let stopped = false;
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        const stop = interrupted();
        if (stop) return reject(stop);
        const elapsed = ctx.currentTime - t0;
        // The pattern has no hap after the last bar, so what is queued now is the last bar itself.
        if (!stopped && elapsed >= seconds) {
          stopped = true;
          scheduler.stop();
        }
        onProgress({ elapsed: Math.min(seconds, Math.max(0, elapsed)), tail: elapsed >= seconds });
        if (elapsed >= seconds + tailSeconds + 0.1) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
    cleanup();
    await restore();
    // The last block arrives after "stop".
    await new Promise((r) => setTimeout(r, 150));
    const frames = Math.round((seconds + tailSeconds) * ctx.sampleRate);
    return { channels: assemble(blocks, Math.round(t0 * ctx.sampleRate), frames), sampleRate: ctx.sampleRate };
  } catch (err) {
    cleanup();
    await restore();
    throw err;
  }
}
