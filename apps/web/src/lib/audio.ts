// Audio stats from Strudel's output.
//
// The Strudel REPL bundle keeps its AudioContext private, so we tap it from
// outside: every connect() to an AudioDestinationNode also feeds one shared
// AnalyserNode on that context. This must run before Strudel creates any node.

let analyser: AnalyserNode | null = null;

export function installAudioTap() {
  const proto = AudioNode.prototype as AudioNode & { __jamTapped?: boolean };
  if (proto.__jamTapped) return;
  proto.__jamTapped = true;
  const original = proto.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  proto.connect = function (this: AudioNode, ...args: unknown[]) {
    const result = original.apply(this, args);
    const dest = args[0];
    if (dest instanceof AudioDestinationNode && this !== analyser) {
      const ctx = this.context as AudioContext;
      if (!analyser || analyser.context !== ctx) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
      }
      original.call(this, analyser);
    }
    return result;
  } as typeof proto.connect;
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
  if (!analyser) return null;
  const a = analyser;
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
