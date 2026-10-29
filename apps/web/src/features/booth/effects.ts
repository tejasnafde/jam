// The booth effects chain. Pitch work (autotune, octave layer) runs offline on
// the raw take; the rest is a Web Audio graph rendered in an OfflineAudioContext,
// so the preview and the saved WAV are the same audio.

import { HOP, pitchTrack, shiftPitch, tuneCurve, type Key, type Scale } from "./dsp/pitch";

export const DELAY_DIVISIONS = { "1/4": 1, "1/8": 0.5, "3/16": 0.75, "1/16": 0.25 } as const;
export type DelayDivision = keyof typeof DELAY_DIVISIONS;

export interface Effects {
  autotune: { on: boolean; key: Key; scale: Scale; speed: number };
  octave: { on: boolean; shift: -12 | 12; level: number };
  highpass: { on: boolean; hz: number };
  lowpass: { on: boolean; hz: number };
  distortion: { on: boolean; drive: number };
  delay: { on: boolean; division: DelayDivision; feedback: number; mix: number };
  reverb: { on: boolean; seconds: number; mix: number };
}

export const DRY: Effects = {
  autotune: { on: false, key: "C", scale: "major", speed: 0.5 },
  octave: { on: false, shift: -12, level: 0.5 },
  highpass: { on: false, hz: 120 },
  lowpass: { on: false, hz: 8000 },
  distortion: { on: false, drive: 0.3 },
  delay: { on: false, division: "1/8", feedback: 0.35, mix: 0.25 },
  reverb: { on: false, seconds: 2, mix: 0.25 },
};

export type PresetName = "dry" | "far away" | "hard tune" | "dark double";

/** Presets keep the chosen key and scale. */
export function preset(name: PresetName, current: Effects): Effects {
  const { key, scale } = current.autotune;
  const base: Effects = { ...DRY, autotune: { ...DRY.autotune, key, scale } };
  switch (name) {
    case "dry":
      return base;
    case "far away":
      return {
        ...base,
        highpass: { on: true, hz: 500 },
        lowpass: { on: true, hz: 3000 },
        delay: { on: true, division: "1/4", feedback: 0.4, mix: 0.3 },
        reverb: { on: true, seconds: 4, mix: 0.5 },
      };
    case "hard tune":
      return {
        ...base,
        autotune: { on: true, key, scale, speed: 1 },
        highpass: { on: true, hz: 100 },
        reverb: { on: true, seconds: 1.5, mix: 0.15 },
      };
    case "dark double":
      return {
        ...base,
        autotune: { on: true, key, scale, speed: 0.6 },
        octave: { on: true, shift: -12, level: 0.7 },
        lowpass: { on: true, hz: 2500 },
        distortion: { on: true, drive: 0.15 },
        reverb: { on: true, seconds: 2.5, mix: 0.3 },
      };
  }
}

/** Human-readable ops for the sample record, e.g. ["autotune:hard:C major", "octave:-12"]. */
export function opsFor(fx: Effects, bpm: number): string[] {
  const ops: string[] = [];
  const a = fx.autotune;
  if (a.on) ops.push(`autotune:${a.speed >= 0.8 ? "hard" : "natural"}:${a.key} ${a.scale}`);
  if (fx.octave.on) ops.push(`octave:${fx.octave.shift > 0 ? "+" : ""}${fx.octave.shift}`);
  if (fx.highpass.on) ops.push(`highpass:${Math.round(fx.highpass.hz)}`);
  if (fx.lowpass.on) ops.push(`lowpass:${Math.round(fx.lowpass.hz)}`);
  if (fx.distortion.on) ops.push(`distortion:${fx.distortion.drive.toFixed(2)}`);
  if (fx.delay.on) ops.push(`delay:${fx.delay.division}@${Math.round(bpm)}bpm`);
  if (fx.reverb.on) ops.push(`reverb:${fx.reverb.seconds}s`);
  return ops;
}

/** Stereo noise with an exponential decay: a plain, smooth room. */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}

function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const k = 1 + drive * 40;
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/** Wires the graph effects after `input` and returns the last node. */
function buildChain(ctx: BaseAudioContext, input: AudioNode, fx: Effects, bpm: number): AudioNode {
  let node = input;
  const then = <T extends AudioNode>(next: T) => {
    node.connect(next);
    node = next;
    return next;
  };
  if (fx.highpass.on) then(new BiquadFilterNode(ctx, { type: "highpass", frequency: fx.highpass.hz }));
  if (fx.lowpass.on) then(new BiquadFilterNode(ctx, { type: "lowpass", frequency: fx.lowpass.hz }));
  if (fx.distortion.on) {
    then(new WaveShaperNode(ctx, { curve: driveCurve(fx.distortion.drive), oversample: "4x" }));
    then(new GainNode(ctx, { gain: 1 - fx.distortion.drive * 0.4 }));
  }
  const wet = (build: (from: AudioNode) => AudioNode, mix: number) => {
    const sum = new GainNode(ctx);
    node.connect(new GainNode(ctx, { gain: 1 - mix })).connect(sum);
    build(node)
      .connect(new GainNode(ctx, { gain: mix }))
      .connect(sum);
    node = sum;
  };
  if (fx.delay.on) {
    const { division, feedback, mix } = fx.delay;
    wet((from) => {
      const delay = new DelayNode(ctx, { maxDelayTime: 4, delayTime: (60 / bpm) * DELAY_DIVISIONS[division] });
      const fb = new GainNode(ctx, { gain: feedback });
      from.connect(delay).connect(fb).connect(delay);
      return delay;
    }, mix);
  }
  if (fx.reverb.on) {
    wet((from) => from.connect(new ConvolverNode(ctx, { buffer: impulse(ctx, fx.reverb.seconds) })), fx.reverb.mix);
  }
  return node;
}

/** Seconds of tail to render after the take ends. The reverb follows the delay, so the tails add up. */
export function tailSeconds(fx: Effects, bpm: number): number {
  let tail = 0.05;
  if (fx.delay.on) {
    const t = (60 / bpm) * DELAY_DIVISIONS[fx.delay.division];
    // Until the echoes fall below -40 dB.
    const repeats = fx.delay.feedback > 0 ? Math.log(0.01) / Math.log(fx.delay.feedback) : 1;
    tail += Math.min(8, t * repeats);
  }
  if (fx.reverb.on) tail += fx.reverb.seconds;
  return Math.min(16, tail);
}

export const needsPitch = (fx: Effects) => fx.autotune.on || fx.octave.on;

/**
 * Applies pitch work offline. `track` is the dry take's pitch track: it does not
 * depend on the settings, so callers cache it per take. Exported for tests.
 */
export function pitchStage(
  dry: Float32Array,
  sampleRate: number,
  fx: Effects,
  track = pitchTrack(dry, sampleRate),
): Float32Array {
  let x = dry;
  let pitch = track;
  if (fx.autotune.on) {
    const shift = tuneCurve(track, sampleRate, fx.autotune);
    const ratio = (h: number) => 2 ** ((shift[h] ?? 0) / 12);
    x = shiftPitch(dry, (i) => ratio(Math.floor(i / HOP)), sampleRate, track);
    pitch = track.map((hz, h) => hz * ratio(h)); // the tuned pitch, for the octave layer
  }
  if (fx.octave.on) {
    const ratio = 2 ** (fx.octave.shift / 12);
    const layer = shiftPitch(x, () => ratio, sampleRate, pitch);
    const mixed = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) mixed[i] = (x[i] ?? 0) + fx.octave.level * (layer[i] ?? 0);
    x = mixed;
  }
  return x;
}

export interface PitchJob {
  dry: Float32Array;
  sampleRate: number;
  fx: Effects;
  track?: Float32Array;
}

/** Runs pitchStage in a Web Worker, so long takes do not freeze the page. Returns the track for the cache. */
export function pitchInWorker(job: PitchJob): Promise<{ x: Float32Array; track: Float32Array }> {
  const worker = new Worker(new URL("./pitch.worker.ts", import.meta.url), { type: "module" });
  return new Promise<{ x: Float32Array; track: Float32Array }>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ x: Float32Array; track: Float32Array }>) => resolve(e.data);
    worker.onerror = (e) => reject(new Error(e.message || "The pitch worker failed"));
    worker.postMessage(job);
  }).finally(() => worker.terminate());
}

/** Renders the take (after pitchStage) to a stereo buffer, peak-normalized below 0 dBFS if it would clip. */
export async function renderTake(x: Float32Array, sampleRate: number, fx: Effects, bpm: number): Promise<AudioBuffer> {
  const length = x.length + Math.ceil(tailSeconds(fx, bpm) * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const buf = ctx.createBuffer(1, x.length, sampleRate);
  buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  buildChain(ctx, src, fx, bpm).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++)
    for (const s of out.getChannelData(c)) peak = Math.max(peak, Math.abs(s));
  if (peak > 0.98) {
    for (let c = 0; c < out.numberOfChannels; c++) {
      const data = out.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = ((data[i] ?? 0) * 0.98) / peak;
    }
  }
  return out;
}
