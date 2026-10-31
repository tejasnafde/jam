// Audio stats from Strudel's output.
//
// The Strudel REPL bundle keeps its AudioContext private, so we tap it from
// outside: every connect() to an AudioDestinationNode also feeds an
// AnalyserNode on that context (one per context). This must run before
// Strudel creates any node.
//
// Other contexts connect to a destination too: Strudel renders each reverb in
// an OfflineAudioContext, and the vocal booth has its own AudioContext. Those
// must never replace the music's analyser, or every reading after the first
// .room() is silence. So offline contexts are not tapped, and readings come
// from Strudel's own context when Strudel is loaded.

const analysers = new WeakMap<BaseAudioContext, AnalyserNode>();
let latest: AnalyserNode | null = null;
/** AudioNode.connect before the tap, so a recorder can reach the speakers without feeding the tap. */
let untapped: ((this: AudioNode, ...args: unknown[]) => unknown) | null = null;

function makeAnalyser(ctx: BaseAudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  analysers.set(ctx, analyser);
  return analyser;
}

/** Strudel's context, from the globals the REPL's prebake sets. Null before Strudel loads. */
function musicContext(): BaseAudioContext | null {
  const get = (globalThis as { getAudioContext?: () => BaseAudioContext }).getAudioContext;
  return typeof get === "function" ? get() : null;
}

function currentAnalyser(): AnalyserNode | null {
  const ctx = musicContext();
  return (ctx && analysers.get(ctx)) ?? latest;
}

export function installAudioTap() {
  const proto = AudioNode.prototype as AudioNode & { __jamTapped?: boolean };
  if (proto.__jamTapped) return;
  proto.__jamTapped = true;
  const original = proto.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  untapped = original;
  proto.connect = function (this: AudioNode, ...args: unknown[]) {
    const result = original.apply(this, args);
    const dest = args[0];
    const ctx = this.context;
    if (!(dest instanceof AudioDestinationNode)) return result;
    // An offline render is never heard.
    if (typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext) return result;
    const analyser = analysers.get(ctx) ?? makeAnalyser(ctx);
    if (this === analyser) return result;
    latest = analyser;
    original.call(this, analyser);
    return result;
  } as typeof proto.connect;
}

/**
 * Strudel's AudioContext and its tap: every sound Strudel sends to the speakers also reaches
 * the tap, so a recorder connected to it hears exactly the music. Null before Strudel loads.
 */
export function musicTap(): { ctx: AudioContext; tap: AnalyserNode } | null {
  const ctx = musicContext();
  if (!(ctx instanceof AudioContext)) return null;
  return { ctx, tap: analysers.get(ctx) ?? makeAnalyser(ctx) };
}

/** Connects without the tap, so a recorder's own route to the speakers does not loop back into it. */
export function connectUntapped(from: AudioNode, to: AudioNode) {
  if (untapped) untapped.call(from, to);
  else from.connect(to);
}

/** Loudness (RMS) and the share of spectral energy in each band. */
export interface Reading {
  rms: number;
  low: number;
  mid: number;
  high: number;
}

let timeBuf: Float32Array<ArrayBuffer> | null = null;
let freqBuf: Float32Array<ArrayBuffer> | null = null;

/** One instant reading, or null before any sound has been routed. */
export function read(): Reading | null {
  const a = currentAnalyser();
  if (!a) return null;
  if (!timeBuf || timeBuf.length !== a.fftSize) timeBuf = new Float32Array(a.fftSize);
  if (!freqBuf || freqBuf.length !== a.frequencyBinCount) freqBuf = new Float32Array(a.frequencyBinCount);
  a.getFloatTimeDomainData(timeBuf);
  a.getFloatFrequencyData(freqBuf);

  let sum = 0;
  for (const s of timeBuf) sum += s * s;
  const rms = Math.sqrt(sum / timeBuf.length);

  const binHz = a.context.sampleRate / a.fftSize;
  let low = 0;
  let mid = 0;
  let high = 0;
  for (let i = 1; i < freqBuf.length; i++) {
    const db = freqBuf[i];
    if (db === undefined || !Number.isFinite(db)) continue;
    const p = 10 ** (db / 10); // dB to power
    const hz = i * binHz;
    if (hz < 250) low += p;
    else if (hz < 4000) mid += p;
    else high += p;
  }
  const total = low + mid + high;
  if (total <= 0) return { rms, low: 0, mid: 0, high: 0 };
  return { rms, low: low / total, mid: mid / total, high: high / total };
}

/** Averages readings over a window. Resolves null if nothing was audible. */
export function measure(windowMs: number, everyMs = 100): Promise<Reading | null> {
  return new Promise((resolve) => {
    const acc = { rms: 0, low: 0, mid: 0, high: 0 };
    let n = 0;
    const id = setInterval(() => {
      const r = read();
      if (r && r.rms > 1e-4) {
        acc.rms += r.rms;
        acc.low += r.low;
        acc.mid += r.mid;
        acc.high += r.high;
        n++;
      }
    }, everyMs);
    setTimeout(() => {
      clearInterval(id);
      if (n === 0) return resolve(null);
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      resolve({ rms: clamp(acc.rms / n), low: clamp(acc.low / n), mid: clamp(acc.mid / n), high: clamp(acc.high / n) });
    }, windowMs);
  });
}
