import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type MicPhase = "off" | "asking" | "denied" | "ready" | "counting" | "recording";

/** A mono take: raw mic samples at the context rate. */
export interface Take {
  data: Float32Array;
  sampleRate: number;
}

export const MAX_TAKE_SECONDS = 120;

/** Clicks on each count-in beat from `t0` (AudioContext time), accent on the first beat of a bar. */
function scheduleClicks(ctx: AudioContext, t0: number, beats: number, beatSec: number): OscillatorNode[] {
  return Array.from({ length: beats }, (_, b) => {
    const t = t0 + b * beatSec;
    const osc = new OscillatorNode(ctx, { frequency: b % 4 === 0 ? 1600 : 1000 });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0.4, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(env).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
    return osc;
  });
}

/** Mono mix of a decoded take, minus the first `trimSec` seconds. */
function toTake(buf: AudioBuffer, trimSec: number): Take {
  const from = Math.min(buf.length, Math.max(0, Math.round(trimSec * buf.sampleRate)));
  const data = new Float32Array(buf.length - from);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) + (ch[from + i] ?? 0) / buf.numberOfChannels;
  }
  return { data, sampleRate: buf.sampleRate };
}

/** Mic access, a live analyser, count-in and MediaRecorder capture. */
export function useRecorder(onTake: (take: Take) => void) {
  const [phase, setPhase] = useState<MicPhase>("off");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const clicks = useRef<OscillatorNode[]>([]);
  const timers = useRef<number[]>([]);
  // release() bumps this, so async work that started before it drops its result.
  const generation = useRef(0);
  const onTakeRef = useRef(onTake);
  useEffect(() => {
    onTakeRef.current = onTake;
  });

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    clicks.current.forEach((osc) => osc.stop());
    clicks.current = [];
  };

  const enable = useCallback(async () => {
    const gen = generation.current;
    setPhase("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (gen !== generation.current) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new AudioContext();
      const an = new AnalyserNode(ctx, { fftSize: 2048 });
      ctx.createMediaStreamSource(stream).connect(an);
      streamRef.current = stream;
      ctxRef.current = ctx;
      setAnalyser(an);
      setPhase("ready");
    } catch {
      if (gen === generation.current) setPhase("denied");
    }
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else {
      recRef.current = null;
      setPhase((p) => (p === "counting" ? "ready" : p));
    }
  }, []);

  const record = useCallback(
    (countInBeats: number, bpm: number) => {
      const ctx = ctxRef.current;
      const stream = streamRef.current;
      if (!ctx || !stream) return;
      const gen = generation.current;
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      // The take starts on the downbeat: MediaRecorder runs through the count-in, and the
      // lead (on the AudioContext clock, from when the recorder started) is trimmed after decode.
      let trimSec = 0;
      let downbeatAt = 0;
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstart = () => {
        const lead = countInBeats > 0 ? 0.05 + countInBeats * (60 / bpm) : 0;
        clicks.current = scheduleClicks(ctx, ctx.currentTime + 0.05, countInBeats, 60 / bpm);
        // The singer hears the clicks late by the output latency.
        trimSec = lead + (countInBeats > 0 ? ctx.outputLatency || 0 : 0);
        downbeatAt = ctx.currentTime + lead;
        const go = () => {
          setStartedAt(Date.now());
          setPhase("recording");
        };
        if (lead > 0) {
          setPhase("counting");
          timers.current.push(window.setTimeout(go, lead * 1000));
        } else go();
        timers.current.push(window.setTimeout(stop, (lead + MAX_TAKE_SECONDS) * 1000));
      };
      rec.onstop = async () => {
        recRef.current = null;
        const cancelled = ctx.currentTime < downbeatAt; // stopped during the count-in
        if (gen !== generation.current) return;
        setPhase("ready");
        if (cancelled) return;
        try {
          const encoded = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
          // A context of its own: release() closes the live one, which would reject this decode.
          const buf = await new OfflineAudioContext(1, 1, ctx.sampleRate).decodeAudioData(encoded);
          const take = toTake(buf, trimSec);
          if (gen !== generation.current) return;
          if (take.data.length === 0) throw new Error("The take is empty.");
          onTakeRef.current(take);
        } catch (err) {
          if (gen !== generation.current) return;
          toast.error("The take did not record", {
            description: err instanceof Error ? err.message : "The browser could not decode it. Try again.",
          });
        }
      };
      recRef.current = rec;
      void ctx.resume().then(() => {
        if (gen === generation.current && recRef.current === rec) rec.start();
      });
      setPhase("counting");
    },
    [stop],
  );

  const release = useCallback(() => {
    generation.current++;
    clearTimers();
    if (recRef.current) {
      if (recRef.current.state !== "inactive") recRef.current.stop();
      recRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setAnalyser(null);
    setPhase("off");
  }, []);

  useEffect(() => release, [release]);

  return { phase, analyser, startedAt, ctx: ctxRef, enable, record, stop, release };
}
