import { useCallback, useEffect, useRef, useState } from "react";

export type MicPhase = "off" | "asking" | "denied" | "ready" | "counting" | "recording";

/** A mono take: raw mic samples at the context rate. */
export interface Take {
  data: Float32Array;
  sampleRate: number;
}

export const MAX_TAKE_SECONDS = 120;

/** Clicks on each count-in beat, accent on the first beat of a bar. */
function scheduleClicks(ctx: AudioContext, beats: number, beatSec: number) {
  const t0 = ctx.currentTime + 0.05;
  for (let b = 0; b < beats; b++) {
    const t = t0 + b * beatSec;
    const osc = new OscillatorNode(ctx, { frequency: b % 4 === 0 ? 1600 : 1000 });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0.4, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(env).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }
  return 0.05 + beats * beatSec;
}

/** Mic access, a live analyser, count-in and MediaRecorder capture. */
export function useRecorder(onTake: (take: Take) => void) {
  const [phase, setPhase] = useState<MicPhase>("off");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timers = useRef<number[]>([]);
  const onTakeRef = useRef(onTake);
  useEffect(() => {
    onTakeRef.current = onTake;
  });

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  const enable = useCallback(async () => {
    setPhase("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = new AudioContext();
      const an = new AnalyserNode(ctx, { fftSize: 2048 });
      ctx.createMediaStreamSource(stream).connect(an);
      streamRef.current = stream;
      ctxRef.current = ctx;
      setAnalyser(an);
      setPhase("ready");
    } catch {
      setPhase("denied");
    }
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else setPhase((p) => (p === "counting" ? "ready" : p));
  }, []);

  const record = useCallback(
    (countInBeats: number, bpm: number) => {
      const ctx = ctxRef.current;
      const stream = streamRef.current;
      if (!ctx || !stream) return;
      void ctx.resume();
      const start = () => {
        const rec = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          recRef.current = null;
          setPhase("ready");
          const encoded = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
          const buf = await ctx.decodeAudioData(encoded);
          const data = new Float32Array(buf.length);
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const ch = buf.getChannelData(c);
            for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) + (ch[i] ?? 0) / buf.numberOfChannels;
          }
          onTakeRef.current({ data, sampleRate: buf.sampleRate });
        };
        recRef.current = rec;
        rec.start();
        setStartedAt(Date.now());
        setPhase("recording");
        timers.current.push(window.setTimeout(stop, MAX_TAKE_SECONDS * 1000));
      };
      if (countInBeats > 0) {
        setPhase("counting");
        const lead = scheduleClicks(ctx, countInBeats, 60 / bpm);
        timers.current.push(window.setTimeout(start, lead * 1000));
      } else start();
    },
    [stop],
  );

  const release = useCallback(() => {
    clearTimers();
    if (recRef.current) {
      recRef.current.onstop = null; // the context closes below: drop the take
      recRef.current.stop();
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
